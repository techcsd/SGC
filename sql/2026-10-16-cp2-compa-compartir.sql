-- CP2 — Compa: compartir una conversación + vista de admin "Conversaciones de
-- Compa". Aditivo. Las marcas automáticas (contradicción / prometió y no hizo /
-- herramienta con error) NO necesitan columnas nuevas: ya quedan en
-- sgc.assistant_acciones desde CP3/CP9 (tool='validador_honestidad'/
-- 'validador_promesa', ok=false = la marca; una tool normal con ok=false =
-- error de herramienta) — se calculan con EXISTS, no se duplican.

-- ── 1) Tabla de conversaciones compartidas ──────────────────────────────────
create table if not exists sgc.assistant_compartidas (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references sgc.assistant_conversaciones(id) on delete cascade,
  compartida_con  uuid not null references sgc.usuarios(id) on delete cascade,
  compartida_por  uuid not null default auth.uid() references sgc.usuarios(id),
  mensaje         text,
  created_at      timestamptz not null default now(),
  vista_at        timestamptz,
  unique (conversacion_id, compartida_con)
);
create index if not exists idx_assistant_compartidas_con
  on sgc.assistant_compartidas (compartida_con, created_at desc);
create index if not exists idx_assistant_compartidas_conv
  on sgc.assistant_compartidas (conversacion_id);

alter table sgc.assistant_compartidas enable row level security;

drop policy if exists "assistant_compartidas: select" on sgc.assistant_compartidas;
create policy "assistant_compartidas: select" on sgc.assistant_compartidas for select to authenticated
  using (compartida_con = auth.uid() or compartida_por = auth.uid() or sgc.is_admin());

-- Inserción solo vía RPC (security definer, valida dueño de la conversación);
-- la política es una segunda capa por si alguna vez se inserta directo.
drop policy if exists "assistant_compartidas: insert" on sgc.assistant_compartidas;
create policy "assistant_compartidas: insert" on sgc.assistant_compartidas for insert to authenticated
  with check (
    compartida_por = auth.uid()
    and exists (select 1 from sgc.assistant_conversaciones c where c.id = conversacion_id and c.usuario_id = auth.uid())
  );

drop policy if exists "assistant_compartidas: update propia" on sgc.assistant_compartidas;
create policy "assistant_compartidas: update propia" on sgc.assistant_compartidas for update to authenticated
  using (compartida_con = auth.uid())
  with check (compartida_con = auth.uid());

grant select, insert, update on sgc.assistant_compartidas to authenticated;

-- ── 2) notif_tipo para el aviso de "te compartieron una conversación" ───────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('compa_compartida', 'Te compartieron una conversación con Compa',
        'Alguien compartió contigo una conversación con el asistente.', false,
        array['in_app','push']::text[], true, 71)
on conflict (tipo) do nothing;

-- ── 3) RPC compa_compartir — comparte UNA conversación con varios usuarios ──
create or replace function sgc.compa_compartir(p_conversacion uuid, p_usuarios uuid[], p_mensaje text default null)
returns setof uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_titulo text;
  v_quien  text;
begin
  if not exists (select 1 from sgc.assistant_conversaciones c where c.id = p_conversacion and c.usuario_id = auth.uid()) then
    raise exception 'Solo puedes compartir tus propias conversaciones' using errcode = '42501';
  end if;
  if p_usuarios is null or array_length(p_usuarios, 1) is null then
    raise exception 'Elige al menos un usuario';
  end if;

  select coalesce(titulo, 'una conversación'), nombre into v_titulo, v_quien
    from sgc.assistant_conversaciones c join sgc.usuarios u on u.id = c.usuario_id
   where c.id = p_conversacion;

  return query
    insert into sgc.assistant_compartidas (conversacion_id, compartida_con, compartida_por, mensaje)
    select p_conversacion, dest, auth.uid(), nullif(trim(p_mensaje), '')
      from unnest(p_usuarios) as dest
      where dest <> auth.uid()
    on conflict (conversacion_id, compartida_con) do update
      set mensaje = excluded.mensaje, compartida_por = excluded.compartida_por, created_at = now(), vista_at = null
    returning id;

  perform sgc.notificar_usuarios(
    p_usuarios, 'compa_compartida', 'Te compartieron una conversación con Compa',
    v_quien || ' te compartió: "' || left(v_titulo, 60) || '"' || (case when p_mensaje is not null then ' — ' || left(p_mensaje, 100) else '' end),
    '/asistente?compartida=' || p_conversacion::text, p_conversacion, 'assistant_compartida'
  );
end $$;
grant execute on function sgc.compa_compartir(uuid, uuid[], text) to authenticated;

-- ── 4) Lo que me compartieron ────────────────────────────────────────────────
create or replace function sgc.compa_compartidas_conmigo()
returns table(
  id uuid, conversacion_id uuid, titulo text, compartida_por_nombre text,
  mensaje text, created_at timestamptz, vista_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.conversacion_id, c.titulo, u.nombre, s.mensaje, s.created_at, s.vista_at
    from sgc.assistant_compartidas s
    join sgc.assistant_conversaciones c on c.id = s.conversacion_id
    join sgc.usuarios u on u.id = s.compartida_por
   where s.compartida_con = auth.uid()
   order by s.created_at desc;
$$;
grant execute on function sgc.compa_compartidas_conmigo() to authenticated;

-- ── 5) Ver una conversación compartida (solo lectura) ───────────────────────
create or replace function sgc.compa_conversacion_compartida(p_id uuid)
returns table(mensaje_id uuid, rol text, contenido text, herramientas jsonb, created_at timestamptz)
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_conv uuid;
begin
  select conversacion_id into v_conv from sgc.assistant_compartidas
   where id = p_id and compartida_con = auth.uid();
  if v_conv is null then
    raise exception 'Esta conversación no te fue compartida' using errcode = '42501';
  end if;
  update sgc.assistant_compartidas set vista_at = coalesce(vista_at, now()) where id = p_id;
  return query
    select m.id, m.rol, m.contenido, m.herramientas, m.created_at
      from sgc.assistant_mensajes m
     where m.conversacion_id = v_conv
     order by m.created_at asc;
end $$;
grant execute on function sgc.compa_conversacion_compartida(uuid) to authenticated;

-- ── 6) Admin — "Conversaciones de Compa" (CP2/CP3) ──────────────────────────
-- Conteos + lista con filtros + marcas automáticas derivadas de assistant_acciones
-- (nada nuevo que mantener sincronizado: se calculan al vuelo).
create or replace function sgc.compa_conversaciones_admin(
  p_usuario_id uuid default null, p_desde date default null, p_hasta date default null,
  p_solo_con_problemas boolean default false, p_limite int default 100
)
returns table(
  conversacion_id uuid, usuario_id uuid, usuario_nombre text, titulo text,
  created_at timestamptz, updated_at timestamptz, mensajes_n bigint,
  contradicciones bigint, promesas_sin_accion bigint, errores_tool bigint
)
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select c.id, c.usuario_id, u.nombre::text, c.titulo, c.created_at, c.updated_at,
           (select count(*) from sgc.assistant_mensajes m where m.conversacion_id = c.id),
           (select count(*) from sgc.assistant_acciones a where a.conversacion_id = c.id and a.tool = 'validador_honestidad' and a.ok = false),
           (select count(*) from sgc.assistant_acciones a where a.conversacion_id = c.id and a.tool = 'validador_promesa' and a.ok = false),
           (select count(*) from sgc.assistant_acciones a where a.conversacion_id = c.id and a.ok = false
              and a.tool not in ('validador_honestidad', 'validador_promesa'))
      from sgc.assistant_conversaciones c
      join sgc.usuarios u on u.id = c.usuario_id
     where (p_usuario_id is null or c.usuario_id = p_usuario_id)
       and (p_desde is null or c.created_at::date >= p_desde)
       and (p_hasta is null or c.created_at::date <= p_hasta)
       and (not p_solo_con_problemas or exists (
             select 1 from sgc.assistant_acciones a where a.conversacion_id = c.id and a.ok = false))
     order by c.updated_at desc
     limit greatest(1, least(coalesce(p_limite, 100), 300));
end $$;
grant execute on function sgc.compa_conversaciones_admin(uuid, date, date, boolean, int) to authenticated;

-- Detalle completo (mensajes + modelo/herramientas por mensaje + marcas en línea).
-- CADA llamada queda en auditoria (CP2.5 — "cada vez que el admin abre una
-- conversación queda en la auditoría").
create or replace function sgc.compa_conversacion_admin(p_id uuid)
returns table(
  mensaje_id uuid, rol text, contenido text, herramientas jsonb, created_at timestamptz,
  es_contradiccion boolean, es_promesa_sin_accion boolean
)
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;

  -- sgc.auditoria es genérica de INSERT/UPDATE/DELETE de fila (constraint fija);
  -- "un admin VIO una conversación" no es ninguna de esas → se registra en
  -- assistant_acciones (ya es el log de auditoría de este subsistema).
  insert into sgc.assistant_acciones (conversacion_id, usuario_id, tool, ok, resumen)
  values (p_id, auth.uid(), 'admin_vio_conversacion', true, 'CP2 — admin abrió el detalle de esta conversación');

  return query
    select m.id, m.rol, m.contenido, m.herramientas, m.created_at,
           exists (select 1 from sgc.assistant_acciones a where a.conversacion_id = p_id
                     and a.tool = 'validador_honestidad' and a.ok = false
                     and a.created_at between m.created_at - interval '2 minutes' and m.created_at + interval '2 minutes'),
           exists (select 1 from sgc.assistant_acciones a where a.conversacion_id = p_id
                     and a.tool = 'validador_promesa' and a.ok = false
                     and a.created_at between m.created_at - interval '2 minutes' and m.created_at + interval '2 minutes')
      from sgc.assistant_mensajes m
     where m.conversacion_id = p_id
     order by m.created_at asc;
end $$;
grant execute on function sgc.compa_conversacion_admin(uuid) to authenticated;

-- "Guardar como caso de prueba" y "Enviar a Consultas de Compa" (§B.4) viven en
-- su propia migración: sql/2026-10-16-cp2b-compa-admin-acciones.sql.
