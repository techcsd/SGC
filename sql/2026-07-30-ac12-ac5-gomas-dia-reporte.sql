-- ============================================================================
-- AC12 + AC5 — Fotos de gomas en reporte semanal + día programado (30/07/2026)
-- ----------------------------------------------------------------------------
-- AC12: photo-slots de gomas en el reporte semanal (aplica a todos los vehículos
--       con reporte semanal — camiones y telehandler). Keyed por frecuencia.
-- AC5:  día fijo de reporte por tipo (default domingo; telehandler sábado), no a
--       elección del chofer. Config aditiva editable; marca `fuera_de_dia`; el
--       cálculo de pendiente sigue por semana ISO, con el día para el recordatorio
--       y para marcar reportes hechos fuera del día. Sweep diario de avisos.
-- dow: 0=domingo .. 6=sábado (EXTRACT(dow)).
-- ============================================================================

set search_path = sgc, public;

-- ── AC12 — slots de gomas para el reporte semanal ──────────────────────────
insert into sgc.checklist_foto_slots (frecuencia, seccion, slot, etiqueta, orden, activo)
values
  ('semanal', 'Gomas', 'goma_del_izq',  'Goma delantera izquierda', 50, true),
  ('semanal', 'Gomas', 'goma_del_der',  'Goma delantera derecha',   51, true),
  ('semanal', 'Gomas', 'goma_tras_izq', 'Goma trasera izquierda',   52, true),
  ('semanal', 'Gomas', 'goma_tras_der', 'Goma trasera derecha',     53, true)
on conflict (frecuencia, slot) do update
  set seccion = excluded.seccion, etiqueta = excluded.etiqueta,
      orden = excluded.orden, activo = true;

-- ── AC5 — configuración del día de reporte por tipo de vehículo ────────────
create table if not exists sgc.flota_reporte_dias (
  tipo_vehiculo text primary key,   -- '*' = default global; o un sgc.vehiculos.tipo
  dia_dow       int  not null check (dia_dow between 0 and 6),
  updated_at    timestamptz not null default now()
);
comment on table sgc.flota_reporte_dias is
  'AC5 — día de la semana (0=domingo..6=sábado) en que toca el reporte semanal por tipo de vehículo. La fila "*" es el default global.';

insert into sgc.flota_reporte_dias (tipo_vehiculo, dia_dow) values
  ('*', 0),            -- default: domingo
  ('telehandler', 6)   -- telehandler: sábado
on conflict (tipo_vehiculo) do update set dia_dow = excluded.dia_dow, updated_at = now();

-- Helper: día de reporte de un vehículo (por su tipo; si no, el default '*'; si no, domingo).
create or replace function sgc.dia_reporte_dow(p_vehiculo_id uuid)
returns int language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select coalesce(
    (select d.dia_dow from sgc.flota_reporte_dias d
       join sgc.vehiculos v on v.id = p_vehiculo_id
      where d.tipo_vehiculo = v.tipo),
    (select dia_dow from sgc.flota_reporte_dias where tipo_vehiculo = '*'),
    0
  );
$$;
grant execute on function sgc.dia_reporte_dow(uuid) to authenticated, service_role;

-- Marca aditiva: reporte hecho fuera del día programado (para el contrato offline de la app).
alter table sgc.checklists_vehiculo
  add column if not exists fuera_de_dia boolean not null default false;
comment on column sgc.checklists_vehiculo.fuera_de_dia is
  'AC5 — true si el reporte semanal se registró en un día distinto al programado para el tipo de vehículo.';

-- ── AC5/AC12 — vista de cumplimiento enriquecida (día + fuera de día) ───────
create or replace view sgc.v_reporte_semanal_cumplimiento
with (security_invoker = true) as
 WITH semanas AS (
         SELECT date_trunc('week'::text, CURRENT_DATE::timestamp with time zone)::date - n.n * 7 AS semana_inicio
           FROM generate_series(0, 11) n(n)
        ), veh AS (
         SELECT vehiculos.id, vehiculos.placa, vehiculos.responsable_id, vehiculos.tipo
           FROM sgc.vehiculos
          WHERE COALESCE(vehiculos.activo, true) AND vehiculos.estado <> 'baja'::text
        ), asignado AS (
         SELECT DISTINCT ON (va.vehiculo_id) va.vehiculo_id, va.usuario_id, u.nombre AS chofer_nombre
           FROM sgc.vehiculo_asignaciones va
             LEFT JOIN sgc.usuarios u ON u.id = va.usuario_id
          WHERE va.activa
          ORDER BY va.vehiculo_id, va.desde DESC
        )
 SELECT EXTRACT(isoyear FROM s.semana_inicio)::integer AS anio,
    EXTRACT(week FROM s.semana_inicio)::integer AS semana,
    s.semana_inicio,
    s.semana_inicio + 6 AS semana_fin,
    v.id AS vehiculo_id,
    v.placa,
    COALESCE(a.chofer_nombre, ru.nombre) AS chofer_nombre,
    COALESCE(a.usuario_id, v.responsable_id) AS chofer_usuario_id,
    ck.id AS checklist_id,
    ck.fecha AS reporte_fecha,
    ck.resultado,
    ck.id IS NOT NULL AS tiene_reporte,
    au.nombre AS reportado_por,
    ck.reportado_por_id,
    ck.reportado_at,
    ck.km_reporte,
    -- AC5 — día programado del vehículo y si el reporte se hizo fuera de ese día.
    COALESCE(rd.dia_dow, gd.dia_dow, 0) AS dia_reporte_dow,
    (ck.id IS NOT NULL
      AND EXTRACT(dow FROM ck.fecha)::int <> COALESCE(rd.dia_dow, gd.dia_dow, 0)) AS reportado_fuera_de_dia
   FROM semanas s
     CROSS JOIN veh v
     LEFT JOIN asignado a ON a.vehiculo_id = v.id
     LEFT JOIN sgc.usuarios ru ON ru.id = v.responsable_id
     LEFT JOIN sgc.flota_reporte_dias rd ON rd.tipo_vehiculo = v.tipo
     LEFT JOIN sgc.flota_reporte_dias gd ON gd.tipo_vehiculo = '*'
     LEFT JOIN LATERAL ( SELECT c.id, c.fecha, c.resultado,
            c.creado_por AS reportado_por_id,
            COALESCE(c.capturado_en, c.created_at) AS reportado_at,
            c.kilometraje AS km_reporte
           FROM sgc.checklists_vehiculo c
             JOIN sgc.checklist_plantillas p ON p.id = c.plantilla_id
          WHERE c.vehiculo_id = v.id AND p.frecuencia = 'semanal'::text
            AND c.fecha >= s.semana_inicio AND c.fecha < (s.semana_inicio + 7)
          ORDER BY c.fecha DESC, c.created_at DESC
         LIMIT 1) ck ON true
     LEFT JOIN sgc.usuarios au ON au.id = ck.reportado_por_id
  WHERE sgc.es_flota_elevado() OR COALESCE(a.usuario_id, v.responsable_id) = auth.uid() OR ck.reportado_por_id = auth.uid();

-- ── AC5 — sweep diario: el día que toca, avisar a los que no han reportado ──
create or replace function sgc.sweep_avisos_reporte_semanal()
returns int language plpgsql security definer
set search_path to 'sgc','pg_temp' as $$
declare
  v_inicio date := date_trunc('week', current_date)::date;  -- lunes ISO de esta semana
  v_anio   int  := extract(isoyear from current_date)::int;
  v_sem    int  := extract(week from current_date)::int;
  v_dow    int  := extract(dow from current_date)::int;
  v_n      int  := 0;
begin
  insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, mensaje, severidad, dedup_key)
  select 'reporte_semanal', v.id, asg.conductor_id,
         format('Hoy toca el reporte semanal de %s. Aún no se ha registrado esta semana.', v.placa),
         'media',
         format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
    from sgc.vehiculos v
    left join lateral (
      select va.conductor_id from sgc.vehiculo_asignaciones va
       where va.vehiculo_id = v.id and va.activa
       order by va.desde desc limit 1
    ) asg on true
   where coalesce(v.activo, true) and v.estado <> 'baja'
     and sgc.dia_reporte_dow(v.id) = v_dow
     and not exists (
       select 1 from sgc.checklists_vehiculo c
        join sgc.checklist_plantillas p on p.id = c.plantilla_id
       where c.vehiculo_id = v.id and p.frecuencia = 'semanal'
         and c.fecha >= v_inicio and c.fecha < v_inicio + 7
     )
     and not exists (
       select 1 from sgc.avisos_flota a
       where a.dedup_key = format('reporte_semanal_dia:%s:%s-%s', v.id, v_anio, v_sem)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.sweep_avisos_reporte_semanal() to service_role;

-- Cron diario 06:10 (el sweep decide internamente a qué vehículos les toca hoy).
do $$ begin perform cron.unschedule('sgc-reporte-semanal-dia'); exception when others then null; end $$;
select cron.schedule('sgc-reporte-semanal-dia', '10 6 * * *', $$select sgc.sweep_avisos_reporte_semanal();$$);
