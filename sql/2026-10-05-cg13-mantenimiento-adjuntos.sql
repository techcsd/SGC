-- CG13 — Adjuntos de mantenimiento = imágenes Y PDF (el PDF del taller), con tipo de
-- documento y MIME, legibles dentro del sistema (visor). Tabla aditiva: la columna legacy
-- `mantenimientos.fotos text[]` se conserva (fotos viejas); los adjuntos nuevos (web y app)
-- van a esta tabla. Contrato usable desde la app (PROMPT-83 F2b).
-- Nota (literal): "Raykler want … upload pdf in that sections … that pdf must be readeable
-- into the system … a way to open it … and from the historial of these maintenances too."
-- -------------------------------------------------------------------------------------

create table if not exists sgc.mantenimiento_adjuntos (
  id              uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references sgc.mantenimientos(id) on delete cascade,
  path            text not null,                 -- ruta en el bucket "vehiculos"
  nombre          text,                           -- nombre original mostrado
  mime            text,                           -- p.ej. application/pdf, image/jpeg
  tipo_documento  text not null default 'otro',   -- factura | informe | cotizacion | garantia | foto | otro
  subido_por      uuid references sgc.usuarios(id),
  created_at      timestamptz not null default now()
);

create index if not exists mantenimiento_adjuntos_mant_idx on sgc.mantenimiento_adjuntos (mantenimiento_id);

comment on table sgc.mantenimiento_adjuntos is
  'CG13 — adjuntos (imagen o PDF) de un mantenimiento, con tipo de documento y MIME. Bucket "vehiculos".';

-- ── RLS: ver = puede ver el vehículo del mantenimiento; escribir = flota (operar). ──
alter table sgc.mantenimiento_adjuntos enable row level security;

drop policy if exists mantenimiento_adjuntos_select on sgc.mantenimiento_adjuntos;
create policy mantenimiento_adjuntos_select on sgc.mantenimiento_adjuntos
  for select to authenticated
  using (
    exists (
      select 1 from sgc.mantenimientos m
       where m.id = mantenimiento_id
         and ( sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
               or sgc.submodulo_nivel_explicito('flota.mantenimientos') = any(array['ver','operar']) )
    )
  );

drop policy if exists mantenimiento_adjuntos_write on sgc.mantenimiento_adjuntos;
create policy mantenimiento_adjuntos_write on sgc.mantenimiento_adjuntos
  for all to authenticated
  using (
    exists (
      select 1 from sgc.mantenimientos m
       where m.id = mantenimiento_id
         and ( sgc.is_admin() or sgc.es_flota_elevado()
               or sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
               or sgc.submodulo_nivel_explicito('flota.mantenimientos') = 'operar' )
    )
  )
  with check (
    exists (
      select 1 from sgc.mantenimientos m
       where m.id = mantenimiento_id
         and ( sgc.is_admin() or sgc.es_flota_elevado()
               or sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
               or sgc.submodulo_nivel_explicito('flota.mantenimientos') = 'operar' )
    )
  );

grant select, insert, update, delete on sgc.mantenimiento_adjuntos to authenticated;

-- ── listar_mantenimientos: añade `adjuntos` (array de {id,path,nombre,mime,tipo_documento}). ──
-- Aditivo (no cambia campos existentes) — la app sigue leyendo igual + ahora ve adjuntos.
drop function if exists sgc.listar_mantenimientos(uuid, integer, date, uuid);
create or replace function sgc.listar_mantenimientos(
  p_vehiculo    uuid          default null,
  p_limite      integer       default 50,
  p_cursor_fecha date         default null,
  p_cursor_id   uuid          default null
) returns setof jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
      'id', m.id, 'vehiculo_id', m.vehiculo_id, 'tipo', m.tipo,
      'descripcion', m.descripcion, 'fecha', m.fecha, 'costo', m.costo,
      'kilometraje_al_mantenimiento', m.kilometraje_al_mantenimiento,
      'proveedor', m.proveedor, 'estado', m.estado, 'notas', m.notas,
      'fotos', m.fotos, 'es_prueba', m.es_prueba,
      'incluye_preventivo', m.incluye_preventivo, 'accidente_id', m.accidente_id,
      'creado_por', m.creado_por, 'created_at', m.created_at,
      'vehiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo),
      'creado_por_usuario', case when u.id is not null then jsonb_build_object('nombre', u.nombre) else null end,
      'adjuntos', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', a.id, 'path', a.path, 'nombre', a.nombre, 'mime', a.mime, 'tipo_documento', a.tipo_documento
            ) order by a.created_at)
          from sgc.mantenimiento_adjuntos a where a.mantenimiento_id = m.id
        ), '[]'::jsonb)
    )
  from sgc.mantenimientos m
  left join sgc.vehiculos v on v.id = m.vehiculo_id
  left join sgc.usuarios  u on u.id = m.creado_por
  where ((not m.es_prueba) or sgc.is_admin())
    and ( sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
          or sgc.submodulo_nivel_explicito('flota.mantenimientos') = any(array['ver','operar']) )
    and (p_vehiculo is null or m.vehiculo_id = p_vehiculo)
    and (p_cursor_fecha is null
         or m.fecha < p_cursor_fecha
         or (m.fecha = p_cursor_fecha and m.id < p_cursor_id))
  order by m.fecha desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$function$;

grant execute on function sgc.listar_mantenimientos(uuid, integer, date, uuid) to authenticated;
