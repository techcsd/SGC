-- 2026-10-20-ct1-reuniones-calendar-estado.sql — CT1 (fila 261)
-- Hace visible el resultado real de la sincronización con Google Calendar
-- (hoy el front descarta la respuesta — ver src/shared/services/reuniones.service.ts
-- ~l.128, `void this.sincronizarCalendar(id).catch(() => {})`). Migración aditiva.
begin;

alter table sgc.reuniones add column if not exists calendar_sync_estado text
  not null default 'no_conectado'
  check (calendar_sync_estado in ('no_conectado', 'sincronizado', 'error', 'pendiente'));
alter table sgc.reuniones add column if not exists calendar_sync_error text;
alter table sgc.reuniones add column if not exists calendar_sync_at timestamptz;

comment on column sgc.reuniones.calendar_sync_estado is
  'CT1: estado real del último intento de sincronización con Google Calendar — lo escribe la edge reuniones-calendar en cada intento (crear/actualizar/cancelar).';

-- La edge corre con el JWT del usuario (RLS normal de "reuniones: update" ya
-- permite admin/organizador); solo necesita poder escribir estas 3 columnas,
-- lo que ya cubre el grant existente `grant ... update on sgc.reuniones`.

-- ── RPC: cancelar una reunión (hoy no existía ninguna forma de cancelar desde
-- el SGC — se agrega para que "editar y cancelar disparan actualizar/cancelar"
-- tenga algo real que disparar). Reutiliza la política RLS de update.
create or replace function sgc.reunion_cancelar(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not exists (
    select 1 from sgc.reuniones r where r.id = p_id
      and (sgc.is_admin() or r.organizador_id = auth.uid())
  ) then
    raise exception 'No tienes permiso para cancelar esta reunión' using errcode = '42501';
  end if;
  update sgc.reuniones set estado = 'cancelada', updated_at = now()
   where id = p_id and estado <> 'cancelada';
end;
$$;
grant execute on function sgc.reunion_cancelar(uuid) to authenticated;

-- ── reuniones_listado gana el estado de sincronización (chip en la lista) ────
create or replace function sgc.reuniones_listado(
  p_filtro text default 'proximas',
  p_tipo_id uuid default null, p_proyecto_id uuid default null
) returns table(
  id uuid, tipo_codigo text, tipo_nombre text, tipo_color text, titulo text,
  inicio timestamptz, fin timestamptz, modalidad text, lugar text, enlace text,
  proyecto_id uuid, proyecto_nombre text, organizador_id uuid, organizador_nombre text,
  estado text, fireflies_id text, participantes_n bigint, acuerdos_n bigint, acta_lista boolean,
  calendar_sync_estado text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select r.id, rt.codigo, rt.nombre, rt.color, r.titulo, r.inicio, r.fin, r.modalidad, r.lugar, r.enlace,
         r.proyecto_id, p.nombre::text, r.organizador_id, u.nombre::text, r.estado, r.fireflies_id,
         (select count(*) from sgc.reunion_participantes rp where rp.reunion_id = r.id),
         (select count(*) from sgc.reunion_acuerdos ra where ra.reunion_id = r.id),
         exists (select 1 from sgc.reunion_actas ac where ac.reunion_id = r.id and ac.resumen is not null),
         r.calendar_sync_estado
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

commit;
