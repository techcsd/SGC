-- ============================================================================
-- PROMPT-17 (AS) — FASE 5 — Cronograma por Excel/.mpp (AS21). Aditivo.
-- ----------------------------------------------------------------------------
-- El import ALIMENTA el modelo de cronograma EXISTENTE (Y15/AA24/AG16), no crea
-- uno paralelo. Mapeo:
--   • Cada HOJA del Excel = una torre/etapa → una fila en sgc.fases_proyecto
--     (fase = contenedor, la única jerarquía que el modelo soporta).
--   • Cada fila numerada = una sgc.cronograma_tareas (nombre, fechas, duración,
--     avance real %). Las columnas RESPONSABLE / VOLUMETRIA / RENDIMIENTO y el
--     grupo/sección (p.ej. "ENTREPISO #") no existían en el modelo → se agregan
--     como columnas nullable (no se pierde el dato del cronograma real).
--   • AVANCE ESPERADO % NO se importa: lo calcula el sistema (calcular_avance_obra).
--
-- .mpp = binario propietario de MS Project (OLE2). No hay parser JS/Deno fiable
-- (la única vía real es mpxj/Java como microservicio). Decisión: import por
-- Excel/CSV; para .mpp la UI guía a "Exportar a Excel" desde MS Project. Ver
-- NOTAS-PROMPT-17-AS.md.
--
-- Política de re-import (AS21, default): preview con diff → reemplaza la torre/etapa
-- al confirmar (p_reemplazar=true borra las tareas de esa fase antes de insertar).
-- ============================================================================

set search_path = sgc, public;

-- ── Columnas del cronograma real que faltaban (nullable, retrocompat) ────────
alter table sgc.cronograma_tareas
  add column if not exists responsable   text,
  add column if not exists volumetria    text,
  add column if not exists rendimiento   text,
  add column if not exists grupo         text,
  add column if not exists import_lote   uuid,
  add column if not exists import_origen text;
comment on column sgc.cronograma_tareas.responsable is 'AS21 — responsable de la actividad (import de cronograma).';
comment on column sgc.cronograma_tareas.volumetria  is 'AS21 — volumetría/cantidad de la actividad (texto, import).';
comment on column sgc.cronograma_tareas.rendimiento is 'AS21 — rendimiento (vol/día) de la actividad (texto, import).';
comment on column sgc.cronograma_tareas.grupo       is 'AS21 — sección/agrupador dentro de la torre (p.ej. "ENTREPISO"), del import.';
comment on column sgc.cronograma_tareas.import_lote is 'AS21 — id del lote de import que creó/actualizó la tarea.';

-- ── get-or-create de la fase (torre/etapa) por nombre ────────────────────────
create or replace function sgc.cronograma_fase_por_nombre(p_proyecto_id uuid, p_nombre text)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid; v_orden int;
begin
  select id into v_id from sgc.fases_proyecto
   where proyecto_id = p_proyecto_id and lower(trim(nombre)) = lower(trim(p_nombre))
   limit 1;
  if v_id is not null then return v_id; end if;

  select coalesce(max(orden),0) + 1 into v_orden from sgc.fases_proyecto where proyecto_id = p_proyecto_id;
  insert into sgc.fases_proyecto (proyecto_id, nombre, estado, orden)
  values (p_proyecto_id, trim(p_nombre), 'pendiente', v_orden)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.cronograma_fase_por_nombre(uuid, text) to authenticated, service_role;

-- ── Import: crea/actualiza el cronograma de una torre/etapa (fase) ───────────
-- p_tareas: [{ orden, nombre, responsable, volumetria, fecha_inicio, fecha_fin,
--   dias, avance_pct, grupo, tipo }]. Las fechas del import se respetan tal cual
-- (no se llama a recalcular: el cronograma importado ya trae fechas reales).
create or replace function sgc.cronograma_importar(
  p_proyecto_id uuid,
  p_fase_nombre text,
  p_tareas      jsonb,
  p_reemplazar  boolean default true
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_fase_id uuid;
  v_lote    uuid := gen_random_uuid();
  v_t       jsonb;
  v_borradas int := 0;
  v_creadas  int := 0;
  v_orden    int;
begin
  if not sgc.puede_gestionar_cronograma(p_proyecto_id) then
    raise exception 'No autorizado para gestionar el cronograma de este proyecto.' using errcode = '42501';
  end if;
  if p_tareas is null or jsonb_typeof(p_tareas) <> 'array' or jsonb_array_length(p_tareas) = 0 then
    raise exception 'No hay actividades para importar.';
  end if;

  v_fase_id := sgc.cronograma_fase_por_nombre(p_proyecto_id, coalesce(nullif(trim(p_fase_nombre),''), 'Cronograma'));

  if p_reemplazar then
    with del as (
      delete from sgc.cronograma_tareas
       where proyecto_id = p_proyecto_id and fase_id = v_fase_id
       returning 1)
    select count(*) into v_borradas from del;
  end if;

  for v_t in select * from jsonb_array_elements(p_tareas) loop
    v_orden := coalesce((v_t->>'orden')::int, v_creadas + 1);
    insert into sgc.cronograma_tareas (
      proyecto_id, fase_id, nombre, tipo, orden, duracion_dias_plan,
      fecha_inicio_plan, fecha_fin_plan, avance_pct,
      responsable, volumetria, rendimiento, grupo, import_lote, import_origen)
    values (
      p_proyecto_id, v_fase_id,
      coalesce(nullif(trim(v_t->>'nombre'),''), 'Actividad ' || v_orden),
      coalesce(nullif(v_t->>'tipo',''), 'ordinaria'),
      v_orden,
      greatest(1, coalesce((v_t->>'dias')::numeric, 1)::int),
      nullif(v_t->>'fecha_inicio','')::date,
      nullif(v_t->>'fecha_fin','')::date,
      least(100, greatest(0, coalesce((v_t->>'avance_pct')::numeric, 0))),
      nullif(v_t->>'responsable',''),
      nullif(v_t->>'volumetria',''),
      nullif(v_t->>'rendimiento',''),
      nullif(v_t->>'grupo',''),
      v_lote, 'xlsx');
    v_creadas := v_creadas + 1;
  end loop;

  return jsonb_build_object(
    'fase_id', v_fase_id, 'torre', trim(p_fase_nombre),
    'reemplazadas', v_borradas, 'creadas', v_creadas, 'lote', v_lote);
end;
$$;
grant execute on function sgc.cronograma_importar(uuid, text, jsonb, boolean) to authenticated, service_role;
comment on function sgc.cronograma_importar(uuid, text, jsonb, boolean) is
  'AS21 — importa/actualiza el cronograma de una torre/etapa (fase) desde el parseo del Excel. Reemplaza la fase al confirmar (default). Alimenta el modelo existente (cronograma_tareas).';
