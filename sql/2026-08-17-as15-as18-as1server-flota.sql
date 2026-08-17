-- ============================================================================
-- PROMPT-17 (AS) — FASE 6 — Flota server: avisos masivos (AS15),
--   "ya reportado por" con nombre real (AS18), soporte al tracking (AS1-server).
--   Aditivo / retrocompatible.
-- ----------------------------------------------------------------------------
--   AS15: RPC "marcar todos como atendidos" (masivo, con quién/cuándo, respeta
--         filtros de tipo/vehículo o una lista de ids).
--   AS18: la vista de cumplimiento semanal ("ya reportado por") es security_invoker
--         y resuelve nombres con LEFT JOIN a usuarios → RLS de usuarios lo deja en
--         blanco cuando el reportante es otro usuario (familia AN7). Fix: helper
--         SECURITY DEFINER sgc.nombre_usuario(uuid) y recrear la vista con él.
--   AS1-server: (a) los contadores del pipeline ya existen y están instrumentados
--         (gps_ingesta_log + gps_ingesta_diagnostico, AK13). Se añade un wrapper
--         que combina contadores + edad de la última posición por chofer para el
--         panel de diagnóstico del web/Rutas activas. (b)/(c)/(d) "hace X" contra
--         el último punto real + Realtime + histórico via rutas_historial = lado
--         web (esta ronda) y app (PROMPT-18).
-- ============================================================================

set search_path = sgc, public;

-- ════════════════════════════════════════════════════════════════════════════
-- AS18 — resolver nombres sin chocar con la RLS de usuarios (familia AN7)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.nombre_usuario(p_id uuid)
returns text language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$ select nombre from sgc.usuarios where id = p_id; $$;
grant execute on function sgc.nombre_usuario(uuid) to authenticated, service_role;
comment on function sgc.nombre_usuario(uuid) is
  'AS18 — resuelve el nombre de un usuario saltando la RLS de sgc.usuarios (que sólo deja ver la propia fila). Úsalo en vistas security_invoker para mostrar "reportado por / creado por" de terceros.';

-- Recrear la vista de cumplimiento usando el helper (adiós blancos en "reportado por").
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
         SELECT DISTINCT ON (va.vehiculo_id) va.vehiculo_id, va.usuario_id,
                sgc.nombre_usuario(va.usuario_id)::varchar(150) AS chofer_nombre
           FROM sgc.vehiculo_asignaciones va
          WHERE va.activa
          ORDER BY va.vehiculo_id, va.desde DESC
        )
 SELECT EXTRACT(isoyear FROM s.semana_inicio)::integer AS anio,
    EXTRACT(week FROM s.semana_inicio)::integer AS semana,
    s.semana_inicio,
    s.semana_inicio + 6 AS semana_fin,
    v.id AS vehiculo_id,
    v.placa,
    COALESCE(a.chofer_nombre, sgc.nombre_usuario(v.responsable_id)::varchar(150)) AS chofer_nombre,
    COALESCE(a.usuario_id, v.responsable_id) AS chofer_usuario_id,
    ck.id AS checklist_id,
    ck.fecha AS reporte_fecha,
    ck.resultado,
    ck.id IS NOT NULL AS tiene_reporte,
    sgc.nombre_usuario(ck.reportado_por_id)::varchar(150) AS reportado_por,
    ck.reportado_por_id,
    ck.reportado_at,
    ck.km_reporte,
    COALESCE(rd.dia_dow, gd.dia_dow, 0) AS dia_reporte_dow,
    (ck.id IS NOT NULL
      AND EXTRACT(dow FROM ck.fecha)::int <> COALESCE(rd.dia_dow, gd.dia_dow, 0)) AS reportado_fuera_de_dia
   FROM semanas s
     CROSS JOIN veh v
     LEFT JOIN asignado a ON a.vehiculo_id = v.id
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
  WHERE sgc.es_flota_elevado() OR COALESCE(a.usuario_id, v.responsable_id) = auth.uid() OR ck.reportado_por_id = auth.uid();

-- ════════════════════════════════════════════════════════════════════════════
-- AS15 — Avisos de flota: "marcar todos como atendidos" (masivo)
-- ════════════════════════════════════════════════════════════════════════════
-- Respeta filtros activos (tipo/vehículo) o una lista explícita de ids; sólo toca
-- los que están 'pendiente'; registra quién/cuándo. Guard = el mismo de flota.
create or replace function sgc.atender_avisos_flota(
  p_ids         uuid[] default null,
  p_tipo        text   default null,
  p_vehiculo_id uuid   default null,
  p_nota        text   default null
) returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado para atender avisos de flota.' using errcode = '42501';
  end if;

  update sgc.avisos_flota a set
    estado        = 'atendido',
    atendido_por  = v_uid,
    atendido_at   = now(),
    nota_atencion = coalesce(nullif(trim(coalesce(p_nota,'')),''), a.nota_atencion, 'Atendido en lote')
  where a.estado = 'pendiente'
    and (p_ids is null or a.id = any(p_ids))
    and (p_tipo is null or a.tipo = p_tipo)
    and (p_vehiculo_id is null or a.vehiculo_id = p_vehiculo_id)
    and ((not coalesce(a.es_prueba, false)) or sgc.is_admin());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.atender_avisos_flota(uuid[], text, uuid, text) to authenticated, service_role;
comment on function sgc.atender_avisos_flota(uuid[], text, uuid, text) is
  'AS15 — marca en lote avisos de flota como atendidos (por ids o por filtro tipo/vehículo), registra atendido_por/atendido_at. Devuelve cuántos.';

-- ════════════════════════════════════════════════════════════════════════════
-- AS1-server(a) — Panel de diagnóstico del tracking (contadores + edad de la
-- última posición por chofer). Los contadores crudos ya viven en AK13
-- (gps_ingesta_diagnostico); este wrapper añade la última posición real para
-- responder "¿por qué está congelado?" de un vistazo. Sólo roles elevados.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.tracking_diagnostico(p_desde timestamptz default null)
returns table (
  usuario_id uuid, usuario_nombre text,
  batches int, recibidos bigint, insertados bigint,
  desc_precision bigint, desc_salto bigint, desc_sin_coord bigint,
  ultima_ingesta timestamptz, ultima_posicion timestamptz, minutos_desde_posicion numeric
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with diag as (
    select * from sgc.gps_ingesta_diagnostico(null, null, coalesce(p_desde, now() - interval '2 days'))
  )
  select d.usuario_id, d.usuario_nombre,
         d.batches, d.recibidos, d.insertados,
         d.desc_precision, d.desc_salto, d.desc_sin_coord,
         d.ultima as ultima_ingesta,
         up.capturado_en as ultima_posicion,
         case when up.capturado_en is null then null
              else round(extract(epoch from (now() - up.capturado_en)) / 60.0, 1) end as minutos_desde_posicion
  from diag d
  left join sgc.chofer_ultima_posicion up on up.usuario_id = d.usuario_id
  order by d.ultima desc nulls last;
$$;
grant execute on function sgc.tracking_diagnostico(timestamptz) to authenticated, service_role;
comment on function sgc.tracking_diagnostico(timestamptz) is
  'AS1 — diagnóstico del pipeline de tracking por chofer: recibidos/insertados/descartados (AK13) + edad de la última posición real. Para Rutas activas/Seguimiento. Roles elevados/tecnología.';

-- ── AS1-server(c) — asegurar el grant del histórico por chofer (definer, ap6).
-- El web migra de rutas.getAll() (invoker, oculta rutas por RLS de scope) a este
-- RPC definer con visibilidad por rol elevado. (es_prueba sigue oculto salvo admin;
-- si una ruta legítima quedó marcada es_prueba por herencia, es limpieza de datos.)
-- Grant defensivo: asegura execute para cualquier firma existente de rutas_historial.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'sgc' and p.proname = 'rutas_historial'
  loop
    execute 'grant execute on function ' || r.sig || ' to authenticated, service_role';
  end loop;
end $$;
