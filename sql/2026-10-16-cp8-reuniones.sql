-- CP8 — Módulo Reuniones + notas + enlace a Fireflies. Aditivo. Ver docs/REUNIONES.md
-- para lo confirmado/ajustado de la integración con Fireflies antes de este diseño.

-- ── 1) Tipos de reunión (configurable, con agenda por defecto) ─────────────
create table if not exists sgc.reunion_tipos (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  nombre     text not null,
  color      text not null default '#5b6b80',
  agenda_default jsonb not null default '[]'::jsonb, -- array de strings, puntos de agenda por defecto
  activo     boolean not null default true,
  orden      integer not null default 0
);
insert into sgc.reunion_tipos (codigo, nombre, color, agenda_default, orden) values
  ('obra',         'Obra',           '#175cd3', '["Avance de la semana","Materiales pendientes","Riesgos / bloqueos"]'::jsonb, 1),
  ('coordinacion', 'Coordinación',   '#0891b2', '["Pendientes del equipo","Próximos pasos"]'::jsonb, 2),
  ('gerencia',     'Gerencia',       '#9a3412', '["Avance de obras","Finanzas","Decisiones pendientes"]'::jsonb, 3),
  ('proveedor',    'Proveedor',      '#475467', '["Cotización / propuesta","Condiciones","Próximos pasos"]'::jsonb, 4),
  ('legal',        'Legal',          '#6941c6', '["Estado del caso/expediente","Próximos pasos","Fechas límite"]'::jsonb, 5),
  ('rrhh',         'RRHH',           '#b54708', '["Tema a tratar","Acuerdos"]'::jsonb, 6),
  ('seguridad',    'Seguridad',      '#b42318', '["Incidentes de la semana","Acciones correctivas"]'::jsonb, 7),
  ('cliente',      'Cliente',        '#067647', '["Avance para el cliente","Pendientes del cliente"]'::jsonb, 8),
  ('otra',         'Otra',           '#5b6b80', '[]'::jsonb, 9)
on conflict (codigo) do nothing;
grant select on sgc.reunion_tipos to authenticated;
alter table sgc.reunion_tipos enable row level security;
drop policy if exists "reunion_tipos: select" on sgc.reunion_tipos;
create policy "reunion_tipos: select" on sgc.reunion_tipos for select to authenticated using (true);
drop policy if exists "reunion_tipos: admin escribe" on sgc.reunion_tipos;
create policy "reunion_tipos: admin escribe" on sgc.reunion_tipos for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

-- ── 2) Reuniones ─────────────────────────────────────────────────────────────
create table if not exists sgc.reuniones (
  id                   uuid primary key default gen_random_uuid(),
  tipo_id              uuid not null references sgc.reunion_tipos(id),
  titulo               text not null,
  inicio               timestamptz not null,
  fin                  timestamptz not null,
  modalidad            text not null default 'meet' check (modalidad in ('presencial','meet','mixta')),
  lugar                text,
  enlace               text,
  proyecto_id          uuid references sgc.proyectos(id),
  expediente_id        uuid references sgc.expedientes_legales(id),
  solicitud_compra_id  uuid references sgc.solicitudes_compra(id),
  organizador_id       uuid not null default auth.uid() references sgc.usuarios(id),
  estado               text not null default 'programada'
                          check (estado in ('programada','en_curso','acta_borrador','acta_aprobada','cancelada')),
  google_event_id      text,
  fireflies_id         text,
  cancelada_motivo     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_reuniones_inicio on sgc.reuniones (inicio);
create index if not exists idx_reuniones_proyecto on sgc.reuniones (proyecto_id);
create index if not exists idx_reuniones_organizador on sgc.reuniones (organizador_id);
create index if not exists idx_reuniones_fireflies on sgc.reuniones (fireflies_id) where fireflies_id is not null;

create table if not exists sgc.reunion_participantes (
  id              uuid primary key default gen_random_uuid(),
  reunion_id      uuid not null references sgc.reuniones(id) on delete cascade,
  usuario_id      uuid references sgc.usuarios(id),
  correo_externo  text,
  nombre_externo  text,
  asistio         boolean,
  check (usuario_id is not null or correo_externo is not null)
);
create index if not exists idx_reunion_part_reunion on sgc.reunion_participantes (reunion_id);
create index if not exists idx_reunion_part_usuario on sgc.reunion_participantes (usuario_id) where usuario_id is not null;
create unique index if not exists uq_reunion_part_usuario on sgc.reunion_participantes (reunion_id, usuario_id) where usuario_id is not null;

create table if not exists sgc.reunion_agenda (
  id          uuid primary key default gen_random_uuid(),
  reunion_id  uuid not null references sgc.reuniones(id) on delete cascade,
  orden       integer not null default 0,
  texto       text not null
);
create index if not exists idx_reunion_agenda_reunion on sgc.reunion_agenda (reunion_id, orden);

create table if not exists sgc.reunion_notas (
  id          uuid primary key default gen_random_uuid(),
  reunion_id  uuid not null references sgc.reuniones(id) on delete cascade,
  usuario_id  uuid not null default auth.uid() references sgc.usuarios(id),
  texto       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (reunion_id, usuario_id)
);

create table if not exists sgc.reunion_acuerdos (
  id              uuid primary key default gen_random_uuid(),
  reunion_id      uuid not null references sgc.reuniones(id) on delete cascade,
  texto           text not null,
  responsable_id  uuid references sgc.usuarios(id),
  fecha           date,
  tarea_id        uuid references sgc.tareas(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_reunion_acuerdos_reunion on sgc.reunion_acuerdos (reunion_id);

create table if not exists sgc.reunion_actas (
  id               uuid primary key default gen_random_uuid(),
  reunion_id       uuid not null unique references sgc.reuniones(id) on delete cascade,
  resumen          text,
  transcripcion_url text,
  fireflies_raw    jsonb,
  version          integer not null default 1,
  aprobada_por     uuid references sgc.usuarios(id),
  aprobada_at      timestamptz,
  enviada_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 3) Permisos: módulo 'reuniones' + quién puede VER una reunión ───────────
-- (MODULOS_DISPONIBLES en roles.service.ts se actualiza en el front; aquí solo
-- se otorga por default a los roles ya existentes que correspondan + admin.)
update sgc.roles set modulos = array_append(modulos, 'reuniones')
  where not ('reuniones' = any(modulos))
    and (codigo = 'admin'
         or nombre ilike '%gerenc%' or nombre ilike '%direcci%'
         or nombre ilike '%ingenier%' or codigo ilike 'ingeniero%'
         or codigo = 'logistica'
         or codigo = 'abogado'
         or nombre ilike '%rrhh%' or nombre ilike '%recursos human%');

create or replace function sgc.puede_ver_reunion(p_reunion_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sgc.is_admin()
    or exists (select 1 from sgc.reuniones r where r.id = p_reunion_id and r.organizador_id = auth.uid())
    or exists (select 1 from sgc.reunion_participantes p where p.reunion_id = p_reunion_id and p.usuario_id = auth.uid())
    or sgc.tiene_modulo('reuniones');
$$;
grant execute on function sgc.puede_ver_reunion(uuid) to authenticated;

-- ── 4) RLS ───────────────────────────────────────────────────────────────────
alter table sgc.reuniones enable row level security;
alter table sgc.reunion_participantes enable row level security;
alter table sgc.reunion_agenda enable row level security;
alter table sgc.reunion_notas enable row level security;
alter table sgc.reunion_acuerdos enable row level security;
alter table sgc.reunion_actas enable row level security;

drop policy if exists "reuniones: select" on sgc.reuniones;
create policy "reuniones: select" on sgc.reuniones for select to authenticated
  using (sgc.puede_ver_reunion(id));
drop policy if exists "reuniones: insert" on sgc.reuniones;
create policy "reuniones: insert" on sgc.reuniones for insert to authenticated
  with check (organizador_id = auth.uid() and sgc.tiene_modulo('reuniones'));
drop policy if exists "reuniones: update" on sgc.reuniones;
create policy "reuniones: update" on sgc.reuniones for update to authenticated
  using (sgc.is_admin() or organizador_id = auth.uid())
  with check (sgc.is_admin() or organizador_id = auth.uid());

drop policy if exists "reunion_participantes: select" on sgc.reunion_participantes;
create policy "reunion_participantes: select" on sgc.reunion_participantes for select to authenticated
  using (sgc.puede_ver_reunion(reunion_id));
drop policy if exists "reunion_participantes: insert" on sgc.reunion_participantes;
create policy "reunion_participantes: insert" on sgc.reunion_participantes for insert to authenticated
  with check (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())));
drop policy if exists "reunion_participantes: update propia asistencia" on sgc.reunion_participantes;
create policy "reunion_participantes: update propia asistencia" on sgc.reunion_participantes for update to authenticated
  using (usuario_id = auth.uid() or exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())))
  with check (usuario_id = auth.uid() or exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())));
drop policy if exists "reunion_participantes: delete" on sgc.reunion_participantes;
create policy "reunion_participantes: delete" on sgc.reunion_participantes for delete to authenticated
  using (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())));

drop policy if exists "reunion_agenda: select" on sgc.reunion_agenda;
create policy "reunion_agenda: select" on sgc.reunion_agenda for select to authenticated
  using (sgc.puede_ver_reunion(reunion_id));
drop policy if exists "reunion_agenda: escribir organizador" on sgc.reunion_agenda;
create policy "reunion_agenda: escribir organizador" on sgc.reunion_agenda for all to authenticated
  using (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())))
  with check (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())));

drop policy if exists "reunion_notas: select" on sgc.reunion_notas;
create policy "reunion_notas: select" on sgc.reunion_notas for select to authenticated
  using (sgc.puede_ver_reunion(reunion_id));
drop policy if exists "reunion_notas: escribir la propia" on sgc.reunion_notas;
create policy "reunion_notas: escribir la propia" on sgc.reunion_notas for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid() and sgc.puede_ver_reunion(reunion_id));

drop policy if exists "reunion_acuerdos: select" on sgc.reunion_acuerdos;
create policy "reunion_acuerdos: select" on sgc.reunion_acuerdos for select to authenticated
  using (sgc.puede_ver_reunion(reunion_id));
drop policy if exists "reunion_acuerdos: escribir participante" on sgc.reunion_acuerdos;
create policy "reunion_acuerdos: escribir participante" on sgc.reunion_acuerdos for all to authenticated
  using (sgc.puede_ver_reunion(reunion_id)) with check (sgc.puede_ver_reunion(reunion_id));

drop policy if exists "reunion_actas: select" on sgc.reunion_actas;
create policy "reunion_actas: select" on sgc.reunion_actas for select to authenticated
  using (sgc.puede_ver_reunion(reunion_id));
drop policy if exists "reunion_actas: escribir organizador" on sgc.reunion_actas;
create policy "reunion_actas: escribir organizador" on sgc.reunion_actas for all to authenticated
  using (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())))
  with check (exists (select 1 from sgc.reuniones r where r.id = reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())));

grant select, insert, update on sgc.reuniones to authenticated;
grant select, insert, update, delete on sgc.reunion_participantes to authenticated;
grant select, insert, update, delete on sgc.reunion_agenda to authenticated;
grant select, insert, update, delete on sgc.reunion_notas to authenticated;
grant select, insert, update, delete on sgc.reunion_acuerdos to authenticated;
grant select, insert, update on sgc.reunion_actas to authenticated;
grant all on sgc.reuniones, sgc.reunion_participantes, sgc.reunion_agenda, sgc.reunion_notas, sgc.reunion_acuerdos, sgc.reunion_actas to service_role;

-- ── 5) notif_tipo ────────────────────────────────────────────────────────────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('reunion_invitacion', 'Te invitaron a una reunión', 'Te agregaron como participante de una reunión en el SGC.', false, array['in_app','push']::text[], true, 72),
  ('reunion_minuta', 'Minuta de reunión', 'Se aprobó y envió la minuta de una reunión en la que participaste.', false, array['in_app','push']::text[], true, 73),
  ('reunion_acuerdo', 'Acuerdo de reunión asignado', 'Te asignaron un acuerdo de una reunión.', true, array['in_app','push']::text[], true, 74)
on conflict (tipo) do nothing;

-- ── 6) RPC: crear reunión (participantes + agenda del tipo) ─────────────────
create or replace function sgc.reunion_crear(
  p_tipo_id uuid, p_titulo text, p_inicio timestamptz, p_fin timestamptz,
  p_modalidad text default 'meet', p_lugar text default null,
  p_proyecto_id uuid default null, p_expediente_id uuid default null, p_solicitud_compra_id uuid default null,
  p_participantes_usuarios uuid[] default '{}', p_participantes_externos jsonb default '[]'::jsonb,
  p_agenda text[] default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id uuid := gen_random_uuid();
  v_agenda text[];
  v_item text;
  v_orden int := 0;
  v_ext jsonb;
begin
  if not sgc.tiene_modulo('reuniones') and not sgc.is_admin() then
    raise exception 'No tienes acceso al módulo Reuniones' using errcode = '42501';
  end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'La reunión necesita un título.'; end if;
  if p_fin <= p_inicio then raise exception 'La hora de fin debe ser después del inicio.'; end if;

  insert into sgc.reuniones (id, tipo_id, titulo, inicio, fin, modalidad, lugar, proyecto_id, expediente_id, solicitud_compra_id, organizador_id)
  values (v_id, p_tipo_id, btrim(p_titulo), p_inicio, p_fin, coalesce(p_modalidad,'meet'), p_lugar, p_proyecto_id, p_expediente_id, p_solicitud_compra_id, auth.uid());

  insert into sgc.reunion_participantes (reunion_id, usuario_id)
    select distinct v_id, dest from unnest(coalesce(p_participantes_usuarios, '{}')) as dest
    where dest <> auth.uid()
  on conflict (reunion_id, usuario_id) where usuario_id is not null do nothing;
  insert into sgc.reunion_participantes (reunion_id, usuario_id)
    values (v_id, auth.uid())
  on conflict (reunion_id, usuario_id) where usuario_id is not null do nothing;

  for v_ext in select * from jsonb_array_elements(coalesce(p_participantes_externos, '[]'::jsonb)) loop
    insert into sgc.reunion_participantes (reunion_id, correo_externo, nombre_externo)
    values (v_id, v_ext->>'correo', v_ext->>'nombre');
  end loop;

  if p_agenda is not null then
    v_agenda := p_agenda;
  else
    select array(select jsonb_array_elements_text(coalesce(rt.agenda_default, '[]'::jsonb))) into v_agenda
      from sgc.reunion_tipos rt where rt.id = p_tipo_id;
  end if;
  foreach v_item in array coalesce(v_agenda, '{}') loop
    v_orden := v_orden + 1;
    insert into sgc.reunion_agenda (reunion_id, orden, texto) values (v_id, v_orden, v_item);
  end loop;

  perform sgc.notificar_usuarios(p_participantes_usuarios, 'reunion_invitacion', 'Te invitaron a una reunión',
    btrim(p_titulo) || ' · ' || to_char(p_inicio at time zone 'America/Santo_Domingo', 'DD "de" Mon, HH12:MI AM'),
    '/reuniones/' || v_id::text, v_id, 'reunion');

  return v_id;
end $$;
grant execute on function sgc.reunion_crear(uuid, text, timestamptz, timestamptz, text, text, uuid, uuid, uuid, uuid[], jsonb, text[]) to authenticated;

-- ── 7) RPC: listado con filtros ──────────────────────────────────────────────
create or replace function sgc.reuniones_listado(
  p_filtro text default 'proximas', -- proximas | acta_pendiente | pasadas | mias
  p_tipo_id uuid default null, p_proyecto_id uuid default null
) returns table(
  id uuid, tipo_codigo text, tipo_nombre text, tipo_color text, titulo text,
  inicio timestamptz, fin timestamptz, modalidad text, lugar text, enlace text,
  proyecto_id uuid, proyecto_nombre text, organizador_id uuid, organizador_nombre text,
  estado text, fireflies_id text, participantes_n bigint, acuerdos_n bigint, acta_lista boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select r.id, rt.codigo, rt.nombre, rt.color, r.titulo, r.inicio, r.fin, r.modalidad, r.lugar, r.enlace,
         r.proyecto_id, p.nombre::text, r.organizador_id, u.nombre::text, r.estado, r.fireflies_id,
         (select count(*) from sgc.reunion_participantes rp where rp.reunion_id = r.id),
         (select count(*) from sgc.reunion_acuerdos ra where ra.reunion_id = r.id),
         exists (select 1 from sgc.reunion_actas ac where ac.reunion_id = r.id and ac.resumen is not null)
    from sgc.reuniones r
    join sgc.reunion_tipos rt on rt.id = r.tipo_id
    left join sgc.proyectos p on p.id = r.proyecto_id
    join sgc.usuarios u on u.id = r.organizador_id
   where sgc.puede_ver_reunion(r.id)
     and (p_tipo_id is null or r.tipo_id = p_tipo_id)
     and (p_proyecto_id is null or r.proyecto_id = p_proyecto_id)
     and (
       (p_filtro = 'proximas' and r.fin >= now() and r.estado <> 'cancelada')
       or (p_filtro = 'acta_pendiente' and r.estado in ('en_curso','acta_borrador') and r.fin < now() + interval '1 hour')
       or (p_filtro = 'pasadas' and r.fin < now())
       or (p_filtro = 'mias' and (r.organizador_id = auth.uid()
             or exists (select 1 from sgc.reunion_participantes rp where rp.reunion_id = r.id and rp.usuario_id = auth.uid())))
       or (p_filtro is null)
     )
   order by (case when p_filtro = 'pasadas' then r.inicio end) desc,
            (case when p_filtro <> 'pasadas' then r.inicio end) asc
   limit 200;
$$;
grant execute on function sgc.reuniones_listado(text, uuid, uuid) to authenticated;

-- ── 8) RPC: nota propia (upsert) ─────────────────────────────────────────────
create or replace function sgc.reunion_nota_guardar(p_reunion_id uuid, p_texto text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not sgc.puede_ver_reunion(p_reunion_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into sgc.reunion_notas (reunion_id, usuario_id, texto)
  values (p_reunion_id, auth.uid(), p_texto)
  on conflict (reunion_id, usuario_id) do update set texto = excluded.texto, updated_at = now();
end $$;
grant execute on function sgc.reunion_nota_guardar(uuid, text) to authenticated;

-- sgc.tareas.linked_tipo tenía un CHECK cerrado (conduce/ruta/mantenimiento/
-- cronograma) — se extiende con 'reunion' para taggear tareas creadas desde
-- acuerdos de reunión (reusa la columna genérica en vez de crear reunion_id).
alter table sgc.tareas drop constraint if exists tareas_linked_tipo_check;
alter table sgc.tareas add constraint tareas_linked_tipo_check
  check (linked_tipo = any (array['conduce','ruta','mantenimiento','cronograma','reunion']));

-- ── 9) RPC: acuerdos → tareas (NO reusa asignar_tarea_obra: esa exige el
-- submódulo 'obra.plan_dia', que no aplica a reuniones de legal/rrhh/gerencia/
-- proveedor. El permiso correcto aquí es "puede ver la reunión", ya validado). ──
create or replace function sgc.reunion_acuerdo_crear(
  p_reunion_id uuid, p_texto text, p_responsable_id uuid default null, p_fecha date default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
declare v_id uuid;
begin
  if not sgc.puede_ver_reunion(p_reunion_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into sgc.reunion_acuerdos (reunion_id, texto, responsable_id, fecha)
  values (p_reunion_id, btrim(p_texto), p_responsable_id, p_fecha) returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.reunion_acuerdo_crear(uuid, text, uuid, date) to authenticated;

create or replace function sgc.reunion_acuerdos_crear_tareas(p_reunion_id uuid)
returns integer
language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
declare r record; v_n integer := 0; v_titulo text; v_tarea_id uuid;
begin
  if not sgc.puede_ver_reunion(p_reunion_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select titulo into v_titulo from sgc.reuniones where id = p_reunion_id;

  for r in select * from sgc.reunion_acuerdos
            where reunion_id = p_reunion_id and tarea_id is null and responsable_id is not null
  loop
    v_tarea_id := gen_random_uuid();
    insert into sgc.tareas (id, titulo, descripcion, estado, prioridad, asignado_a, asignado_por, fecha_limite, linked_tipo, linked_id)
    values (v_tarea_id, left(r.texto, 200), 'Acuerdo de la reunión: ' || coalesce(v_titulo, ''), 'pendiente', 'media',
            r.responsable_id, auth.uid(), r.fecha, 'reunion', p_reunion_id);
    update sgc.reunion_acuerdos set tarea_id = v_tarea_id where id = r.id;
    if r.responsable_id <> auth.uid() then
      perform sgc.notificar(r.responsable_id, 'reunion_acuerdo', 'Acuerdo de reunión asignado', left(r.texto, 150), '/tareas');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function sgc.reunion_acuerdos_crear_tareas(uuid) to authenticated;

-- ── 10) RPC: acta — guardar borrador / aprobar y enviar ─────────────────────
create or replace function sgc.reunion_acta_guardar(p_reunion_id uuid, p_resumen text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not exists (select 1 from sgc.reuniones r where r.id = p_reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())) then
    raise exception 'Solo el organizador puede editar el acta' using errcode = '42501';
  end if;
  insert into sgc.reunion_actas (reunion_id, resumen) values (p_reunion_id, p_resumen)
  on conflict (reunion_id) do update set resumen = excluded.resumen, version = sgc.reunion_actas.version + 1, updated_at = now();
  update sgc.reuniones set estado = 'acta_borrador', updated_at = now()
   where id = p_reunion_id and estado not in ('acta_aprobada','cancelada');
end $$;
grant execute on function sgc.reunion_acta_guardar(uuid, text) to authenticated;

-- Aprobar: crea las tareas pendientes de los acuerdos con responsable y marca
-- aprobada/enviada. El CORREO en sí lo manda un edge aparte (reuniones-minuta)
-- que el front llama justo después — aquí solo se deja el estado consistente
-- aunque el edge falle (se puede reintentar "Reenviar minuta" sin duplicar tareas).
create or replace function sgc.reunion_acta_aprobar(p_reunion_id uuid)
returns integer
language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
declare v_tareas integer;
begin
  if not exists (select 1 from sgc.reuniones r where r.id = p_reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())) then
    raise exception 'Solo el organizador puede aprobar el acta' using errcode = '42501';
  end if;
  v_tareas := sgc.reunion_acuerdos_crear_tareas(p_reunion_id);
  update sgc.reunion_actas set aprobada_por = auth.uid(), aprobada_at = now() where reunion_id = p_reunion_id;
  update sgc.reuniones set estado = 'acta_aprobada', updated_at = now() where id = p_reunion_id;
  return v_tareas;
end $$;
grant execute on function sgc.reunion_acta_aprobar(uuid) to authenticated;

create or replace function sgc.reunion_acta_marcar_enviada(p_reunion_id uuid)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not exists (select 1 from sgc.reuniones r where r.id = p_reunion_id and (sgc.is_admin() or r.organizador_id = auth.uid())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update sgc.reunion_actas set enviada_at = now() where reunion_id = p_reunion_id;
end $$;
grant execute on function sgc.reunion_acta_marcar_enviada(uuid) to authenticated;

-- ── 11) RPC: detalle completo de ficha (una sola llamada) ───────────────────
create or replace function sgc.reunion_detalle(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp' as $$
declare v jsonb;
begin
  if not sgc.puede_ver_reunion(p_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'reunion', (select to_jsonb(r) || jsonb_build_object('tipo_codigo', rt.codigo, 'tipo_nombre', rt.nombre, 'tipo_color', rt.color,
                  'proyecto_nombre', p.nombre, 'organizador_nombre', u.nombre)
                from sgc.reuniones r join sgc.reunion_tipos rt on rt.id = r.tipo_id
                left join sgc.proyectos p on p.id = r.proyecto_id
                join sgc.usuarios u on u.id = r.organizador_id
                where r.id = p_id),
    'participantes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', rp.id, 'usuario_id', rp.usuario_id, 'nombre', coalesce(pu.nombre, rp.nombre_externo),
                  'correo_externo', rp.correo_externo, 'asistio', rp.asistio)), '[]'::jsonb)
                from sgc.reunion_participantes rp left join sgc.usuarios pu on pu.id = rp.usuario_id
                where rp.reunion_id = p_id),
    'agenda', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'orden', a.orden, 'texto', a.texto) order by a.orden), '[]'::jsonb)
                from sgc.reunion_agenda a where a.reunion_id = p_id),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'usuario_id', n.usuario_id, 'usuario_nombre', nu.nombre,
                  'texto', n.texto, 'es_mia', n.usuario_id = auth.uid())), '[]'::jsonb)
                from sgc.reunion_notas n join sgc.usuarios nu on nu.id = n.usuario_id where n.reunion_id = p_id),
    'acuerdos', (select coalesce(jsonb_agg(jsonb_build_object('id', ac.id, 'texto', ac.texto, 'responsable_id', ac.responsable_id,
                  'responsable_nombre', au.nombre, 'fecha', ac.fecha, 'tarea_id', ac.tarea_id) order by ac.created_at), '[]'::jsonb)
                from sgc.reunion_acuerdos ac left join sgc.usuarios au on au.id = ac.responsable_id where ac.reunion_id = p_id),
    'acta', (select to_jsonb(ac) from sgc.reunion_actas ac where ac.reunion_id = p_id)
  ) into v;
  return v;
end $$;
grant execute on function sgc.reunion_detalle(uuid) to authenticated;

-- ── 11b) Columnas que necesita el edge fireflies-webhook (reunión "sin ligar"
-- creada por Fireflies sin que nadie la programara desde el SGC — no tiene
-- organizador SGC claro hasta que alguien la liga a una obra/tipo real).
alter table sgc.reuniones alter column organizador_id drop not null;
alter table sgc.reuniones add column if not exists sin_ligar boolean not null default false;
alter table sgc.reunion_actas add column if not exists creado_por_tipo text not null default 'manual'
  check (creado_por_tipo in ('manual','fireflies'));

-- Con organizador_id ahora nullable, "mías" y el RLS de reuniones deben seguir
-- excluyendo filas sin dueño de los resultados de un usuario común (ya lo hacen:
-- `r.organizador_id = auth.uid()` es null-safe — null nunca iguala, no hace falta
-- coalesce). Una reunión sin_ligar solo la ve admin o quien tenga el módulo
-- (puede_ver_reunion ya cubre ambos casos) hasta que alguien la liga.

-- ── 12) RPCs para Compa (mis_reuniones, acuerdos_pendientes, resumen_reunion) ─
create or replace function sgc.mis_reuniones_compa()
returns table(id uuid, titulo text, tipo_nombre text, inicio timestamptz, fin timestamptz, modalidad text, enlace text, estado text)
language sql stable security definer set search_path to 'sgc', 'pg_temp' as $$
  select r.id, r.titulo, rt.nombre, r.inicio, r.fin, r.modalidad, r.enlace, r.estado
    from sgc.reuniones r join sgc.reunion_tipos rt on rt.id = r.tipo_id
   where r.fin >= now() and r.estado <> 'cancelada'
     and (r.organizador_id = auth.uid()
          or exists (select 1 from sgc.reunion_participantes rp where rp.reunion_id = r.id and rp.usuario_id = auth.uid()))
   order by r.inicio asc limit 20;
$$;
grant execute on function sgc.mis_reuniones_compa() to authenticated;

create or replace function sgc.acuerdos_pendientes_compa()
returns table(id uuid, texto text, fecha date, reunion_titulo text, tiene_tarea boolean)
language sql stable security definer set search_path to 'sgc', 'pg_temp' as $$
  select a.id, a.texto, a.fecha, r.titulo, a.tarea_id is not null
    from sgc.reunion_acuerdos a join sgc.reuniones r on r.id = a.reunion_id
   where a.responsable_id = auth.uid()
     and not exists (select 1 from sgc.tareas t where t.id = a.tarea_id and t.estado = 'completada')
   order by a.fecha asc nulls last limit 30;
$$;
grant execute on function sgc.acuerdos_pendientes_compa() to authenticated;

create or replace function sgc.resumen_reunion_compa(p_id uuid)
returns table(titulo text, inicio timestamptz, resumen text, acuerdos_n bigint, participantes_n bigint)
language plpgsql stable security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not sgc.puede_ver_reunion(p_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select r.titulo, r.inicio, ac.resumen,
           (select count(*) from sgc.reunion_acuerdos a where a.reunion_id = r.id),
           (select count(*) from sgc.reunion_participantes p where p.reunion_id = r.id)
      from sgc.reuniones r left join sgc.reunion_actas ac on ac.reunion_id = r.id
     where r.id = p_id;
end $$;
grant execute on function sgc.resumen_reunion_compa(uuid) to authenticated;

-- ── 13) RPC: ligar una reunión "sin_ligar" (creada por el webhook de Fireflies
-- sin organizador SGC) a una obra/tipo y adoptarla como propia ────────────────
create or replace function sgc.reunion_ligar(p_id uuid, p_proyecto_id uuid default null, p_tipo_id uuid default null)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('reuniones')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.reuniones where id = p_id and sin_ligar) then
    raise exception 'Esta reunión no está "sin ligar" o no existe.';
  end if;
  update sgc.reuniones set
    sin_ligar = false,
    organizador_id = coalesce(organizador_id, auth.uid()),
    proyecto_id = coalesce(p_proyecto_id, proyecto_id),
    tipo_id = coalesce(p_tipo_id, tipo_id),
    updated_at = now()
  where id = p_id;
  insert into sgc.reunion_participantes (reunion_id, usuario_id)
  values (p_id, auth.uid())
  on conflict (reunion_id, usuario_id) where usuario_id is not null do nothing;
end $$;
grant execute on function sgc.reunion_ligar(uuid, uuid, uuid) to authenticated;
