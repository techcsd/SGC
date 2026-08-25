-- ============================================================================
-- AY FASE 1 — Compa: filtrado de tools (🔴 seguridad) + limpieza de datos.
--
-- Contexto (CONTEXTO-ACTUALIZACION-6 §hallazgos):
--   1) 🔴 `mis_tareas` le devolvió a Test User 3 tareas de OTRAS personas.
--      Causa raíz: el tool apuntaba a `mis_tareas_app`, cuyo WHERE tiene el
--      escape "... OR sgc.tiene_modulo('tareas') OR sgc.is_admin()", pensado
--      para el TABLERO de tareas (un gestor ve todas). Para una tool llamada
--      "mis_tareas" eso es una fuga: cualquier usuario con el módulo `tareas`
--      (p. ej. rol Logística con TAREAS(ASIGNAR)) veía TODAS las tareas.
--      Fix: RPC dedicado `mis_tareas_asistente` con filtro ESTRICTO por
--      identidad (asignado_a o asignado_por = auth.uid()). Sin escape de
--      módulo/admin. `mis_tareas_app` NO se toca (lo usa el tablero de la app).
--   4) Mojibake en títulos/mensajes ("Â¿CuÃ¡ntos…"): UTF-8 doble-codificado.
--      Se reparan las filas existentes (títulos Y mensajes de usuario).
--   5) Conversaciones duplicadas de un solo turno (chip → conversación nueva):
--      se deduplican de forma conservadora (misma normalización de título,
--      <=2 mensajes, se conserva la más reciente). Real multi-turno intacto.
--
-- Documenta además `buscar_usuarios` (existía SOLO en prod, sin migración en el
-- repo) para dejarlo bajo control de versiones y en la suite de auditoría.
--
-- Aditivo y retrocompatible. `usuarios.es_prueba` NO existe todavía (se añade en
-- FASE 6/AY7); por eso el gating de es_prueba-por-actor se difiere a esa fase.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── 1) mis_tareas_asistente — SOLO las tareas del propio usuario ────────────
-- Contrato idéntico a mis_tareas_app PERO con filtro estricto por identidad.
-- Es la tool "mis_tareas" de Compa: "mis" significa MÍAS, no "todas las que mi
-- módulo me deja ver". Un gestor que quiera el tablero completo usa la pantalla
-- de Tareas (o una futura tool `tareas_equipo` explícita), no "mis_tareas".
create or replace function sgc.mis_tareas_asistente(p_incluir_completadas boolean default false)
returns table(
  id uuid, titulo text, descripcion text, estado text, prioridad text,
  asignado_a uuid, asignado_a_nombre text, asignado_por uuid, asignado_por_nombre text,
  proyecto_id uuid, proyecto_nombre text, fecha_limite date, fecha_completada date,
  created_at timestamptz,
  linked_tipo text, linked_id uuid, linked_params jsonb, auto_completada boolean
)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select t.id, t.titulo, t.descripcion, t.estado, t.prioridad,
         t.asignado_a, ua.nombre, t.asignado_por, up.nombre,
         t.proyecto_id, p.nombre, t.fecha_limite, t.fecha_completada, t.created_at,
         t.linked_tipo, t.linked_id, t.linked_params, t.auto_completada
  from sgc.tareas t
  left join sgc.usuarios ua on ua.id = t.asignado_a
  left join sgc.usuarios up on up.id = t.asignado_por
  left join sgc.proyectos p on p.id = t.proyecto_id
  where (t.asignado_a = auth.uid() or t.asignado_por = auth.uid())   -- ← ESTRICTO
    and (p_incluir_completadas or t.estado not in ('completada', 'cancelada'))
  order by
    case t.estado when 'en_progreso' then 0 when 'pendiente' then 1 else 2 end,
    case t.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
    t.fecha_limite nulls last,
    t.created_at desc;
$function$;
grant execute on function sgc.mis_tareas_asistente(boolean) to authenticated, service_role;

-- Tripwire: la definición viva NUNCA debe reintroducir el escape de módulo/admin.
do $$
begin
  if exists (
    select 1 from pg_proc
    where oid = 'sgc.mis_tareas_asistente(boolean)'::regprocedure
      and (pg_get_functiondef(oid) ilike '%tiene_modulo%' or pg_get_functiondef(oid) ilike '%is_admin%')
  ) then
    raise exception 'AY-F1 REGRESIÓN: mis_tareas_asistente NO debe usar tiene_modulo/is_admin — es fuga de datos ajenos (ver hallazgo 1).';
  end if;
end $$;

-- ── 2) buscar_usuarios — documentado en el repo (idéntico a prod) ───────────
-- Directorio de nombres para "¿a quién asigno?". Security definer (la RLS de
-- usuarios es admin-only). Devuelve solo activos, excluye al propio usuario,
-- exige término >=2. Nota de auditoría: expone nombre+email de todos los
-- usuarios a cualquier autenticado (aceptable para un ERP interno; el email no
-- lo necesita la asignación — candidato a recortar en una ronda futura).
create or replace function sgc.buscar_usuarios(p_term text)
returns table(id uuid, nombre text, email text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, u.email
  from sgc.usuarios u
  where coalesce(u.activo, true) = true
    and u.id <> auth.uid()
    and length(trim(coalesce(p_term, ''))) >= 2
    and (u.nombre ilike '%' || trim(p_term) || '%'
         or coalesce(u.email, '') ilike '%' || trim(p_term) || '%')
  order by u.nombre
  limit 20;
$function$;
grant execute on function sgc.buscar_usuarios(text) to authenticated, service_role;

-- ── 3) Reparación de mojibake (UTF-8 doble-codificado) ──────────────────────
-- Un título/mensaje doble-codificado está compuesto SOLO por caracteres del
-- rango Latin-1 (por eso se ve "Â¿"). Revertir = reinterpretar esos bytes
-- Latin-1 como UTF-8. Se hace fila por fila con manejo de excepción: cualquier
-- fila que no revierta limpio se deja intacta (nunca empeoramos el dato).
do $$
declare
  r record;
  fixed text;
begin
  -- Títulos de conversaciones.
  for r in
    select id, titulo from sgc.assistant_conversaciones
    where titulo is not null and titulo ~ '[ÃÂ]'
  loop
    begin
      fixed := convert_from(convert_to(r.titulo, 'LATIN1'), 'UTF8');
      if fixed is not null and fixed <> r.titulo then
        update sgc.assistant_conversaciones set titulo = fixed where id = r.id;
      end if;
    exception when others then null;  -- fila no representable en Latin1 → intacta
    end;
  end loop;

  -- Contenido de mensajes (los del usuario llegaron doble-codificados; los del
  -- asistente están limpios pero el patrón + guard los deja intactos si acaso).
  for r in
    select id, contenido from sgc.assistant_mensajes
    where contenido is not null and contenido ~ '[ÃÂ]'
  loop
    begin
      fixed := convert_from(convert_to(r.contenido, 'LATIN1'), 'UTF8');
      if fixed is not null and fixed <> r.contenido then
        update sgc.assistant_mensajes set contenido = fixed where id = r.id;
      end if;
    exception when others then null;
    end;
  end loop;
end $$;

-- ── 4) Dedupe conservador de conversaciones de un solo turno ────────────────
-- Objetivo: los duplicados accidentales que dejó "cada click de chip crea
-- conversación nueva" (el fix de raíz va en el frontend, AY10). Se conserva la
-- MÁS RECIENTE por (usuario, título normalizado) y se borran las más viejas
-- SOLO si son de un turno (<=2 mensajes). Multi-turno real: intacto.
-- Corre DESPUÉS de reparar mojibake, para que "Â¿QuÃ©…" y "¿Qué…" agrupen.
with ranked as (
  select c.id,
         (select count(*) from sgc.assistant_mensajes m where m.conversacion_id = c.id) as nmsg,
         row_number() over (
           partition by c.usuario_id, lower(trim(coalesce(c.titulo, '')))
           order by c.updated_at desc, c.created_at desc
         ) as rn
  from sgc.assistant_conversaciones c
)
delete from sgc.assistant_conversaciones
where id in (select id from ranked where rn > 1 and nmsg <= 2);

commit;
