-- Reversa de W3 (DS-41): vuelve las 4 vistas a su definicion anterior (sin filtro es_prueba) y borra el helper.
begin;
create or replace view sgc.v_movimientos_inventario as
SELECT s.id AS referencia_id,
    'salida'::text AS tipo,
    s.fecha,
    s.created_at,
    s.bodega_id,
    s.motivo AS concepto,
    s.responsable,
    s.proyecto_id,
    ( SELECT count(*) AS count
           FROM sgc.detalle_salidas d
          WHERE (d.salida_id = s.id)) AS items,
    s.creado_por,
    NULL::text AS origen_tipo,
    NULL::uuid AS origen_proyecto_id,
    NULL::uuid AS salida_id
   FROM sgc.salidas_inventario s
UNION ALL
 SELECT e.id AS referencia_id,
    'entrada'::text AS tipo,
    e.fecha,
    e.created_at,
    e.bodega_id,
    e.referencia AS concepto,
    NULL::character varying AS responsable,
    NULL::uuid AS proyecto_id,
    ( SELECT count(*) AS count
           FROM sgc.detalle_entradas d
          WHERE (d.entrada_id = e.id)) AS items,
    e.creado_por,
    e.origen_tipo,
    e.origen_proyecto_id,
    e.salida_id
   FROM sgc.entradas_inventario e;

create or replace view sgc.v_proyecto_avance as
SELECT id AS proyecto_id,
    codigo,
    nombre,
    porcentaje_pagado,
    COALESCE(( SELECT
                CASE
                    WHEN (sum(pp.cantidad_planeada) > (0)::numeric) THEN LEAST((100)::numeric, round(((100.0 * sum(LEAST(pp.cantidad_ejecutada, pp.cantidad_planeada))) / sum(pp.cantidad_planeada))))
                    ELSE NULL::numeric
                END AS "case"
           FROM sgc.proyecto_partidas pp
          WHERE ((pp.proyecto_id = p.id) AND pp.activa)), ( SELECT round(avg(f.progreso)) AS round
           FROM sgc.fases_proyecto f
          WHERE (f.proyecto_id = p.id)), (0)::numeric) AS avance_trabajado,
    ( SELECT count(*) AS count
           FROM sgc.proyecto_partidas pp
          WHERE ((pp.proyecto_id = p.id) AND pp.activa)) AS n_partidas,
    ((porcentaje_pagado IS NOT NULL) AND (porcentaje_pagado > COALESCE(( SELECT
                CASE
                    WHEN (sum(pp.cantidad_planeada) > (0)::numeric) THEN LEAST((100)::numeric, round(((100.0 * sum(LEAST(pp.cantidad_ejecutada, pp.cantidad_planeada))) / sum(pp.cantidad_planeada))))
                    ELSE NULL::numeric
                END AS "case"
           FROM sgc.proyecto_partidas pp
          WHERE ((pp.proyecto_id = p.id) AND pp.activa)), ( SELECT round(avg(f.progreso)) AS round
           FROM sgc.fases_proyecto f
          WHERE (f.proyecto_id = p.id)), (0)::numeric))) AS pago_excede
   FROM sgc.proyectos p
  WHERE COALESCE(activo, true);

create or replace view sgc.v_proyecto_readiness as
SELECT id AS proyecto_id,
    ((EXISTS ( SELECT 1
           FROM sgc.cuadre_obra c
          WHERE (c.proyecto_id = p.id))) AND (EXISTS ( SELECT 1
           FROM sgc.cuadre_items ci
          WHERE (ci.proyecto_id = p.id)))) AS cuadre_ok,
    COALESCE(( SELECT ((count(*) > 0) AND (count(*) FILTER (WHERE (e.estado = ANY (ARRAY['pendiente'::text, 'cargado'::text]))) = 0))
           FROM sgc.expediente_obra e
          WHERE (e.proyecto_id = p.id)), false) AS expediente_ok,
    ((EXISTS ( SELECT 1
           FROM sgc.proyecto_empleados pe
          WHERE ((pe.proyecto_id = p.id) AND (pe.rol = 'ing_responsable'::text)))) AND (EXISTS ( SELECT 1
           FROM sgc.proyecto_empleados pe
          WHERE ((pe.proyecto_id = p.id) AND (pe.rol = 'ing_residente'::text))))) AS equipo_ok,
    (EXISTS ( SELECT 1
           FROM sgc.bodegas b
          WHERE (b.proyecto_id = p.id))) AS almacen_ok
   FROM sgc.proyectos p;

create or replace view sgc.v_vehiculo_stats as
SELECT v.id AS vehiculo_id,
    v.placa,
    v.kilometraje AS km_actual,
    COALESCE(fc.n_echadas, (0)::bigint) AS combustible_echadas,
    COALESCE(fc.total_galones, (0)::numeric) AS combustible_galones,
    COALESCE(fc.total_monto, (0)::numeric) AS combustible_monto,
    fc.rendimiento_promedio,
    fc.costo_por_km_promedio,
    fc.ultima_echada,
    COALESCE(ck.n_checklists, (0)::bigint) AS checklists_total,
    COALESCE(ck.n_bloqueos, (0)::bigint) AS checklists_bloqueos,
    ck.ultimo_checklist,
    COALESCE(mt.n_mantenimientos, (0)::bigint) AS mantenimientos_total,
    mt.ultimo_mantenimiento,
    v.km_ultimo_mantenimiento,
        CASE
            WHEN ((v.km_ultimo_mantenimiento IS NOT NULL) AND ((v.kilometraje IS NULL) OR (v.km_ultimo_mantenimiento <= v.kilometraje))) THEN (v.km_ultimo_mantenimiento +
            CASE
                WHEN (COALESCE(v.medida_uso, 'km'::text) = 'horas'::text) THEN COALESCE(v.intervalo_mantenimiento_horas, 250)
                ELSE COALESCE(v.intervalo_mantenimiento_km, 5000)
            END)
            ELSE NULL::integer
        END AS proximo_mantenimiento_km,
    COALESCE(asg.n_activas, (0)::bigint) AS asignaciones_activas,
    GREATEST(fc.ultima_echada, ck.ultimo_checklist, mt.ultimo_mantenimiento) AS ultima_actividad,
    ((v.km_ultimo_mantenimiento IS NOT NULL) AND (v.kilometraje IS NOT NULL) AND (v.km_ultimo_mantenimiento > v.kilometraje)) AS mantenimiento_por_revisar
   FROM ((((sgc.vehiculos v
     LEFT JOIN ( SELECT registros_combustible.vehiculo_id,
            count(*) AS n_echadas,
            sum(registros_combustible.galones) AS total_galones,
            sum(registros_combustible.monto) AS total_monto,
            round(avg(registros_combustible.rendimiento_km_gal), 2) AS rendimiento_promedio,
            round(avg(registros_combustible.costo_por_km), 2) AS costo_por_km_promedio,
            max(registros_combustible.fecha) AS ultima_echada
           FROM sgc.registros_combustible
          GROUP BY registros_combustible.vehiculo_id) fc ON ((fc.vehiculo_id = v.id)))
     LEFT JOIN ( SELECT checklists_vehiculo.vehiculo_id,
            count(*) AS n_checklists,
            count(*) FILTER (WHERE (checklists_vehiculo.resultado = 'bloqueado'::text)) AS n_bloqueos,
            max(checklists_vehiculo.fecha) AS ultimo_checklist
           FROM sgc.checklists_vehiculo
          GROUP BY checklists_vehiculo.vehiculo_id) ck ON ((ck.vehiculo_id = v.id)))
     LEFT JOIN ( SELECT mantenimientos.vehiculo_id,
            count(*) AS n_mantenimientos,
            max(mantenimientos.fecha) AS ultimo_mantenimiento
           FROM sgc.mantenimientos
          GROUP BY mantenimientos.vehiculo_id) mt ON ((mt.vehiculo_id = v.id)))
     LEFT JOIN ( SELECT vehiculo_asignaciones.vehiculo_id,
            count(*) AS n_activas
           FROM sgc.vehiculo_asignaciones
          WHERE vehiculo_asignaciones.activa
          GROUP BY vehiculo_asignaciones.vehiculo_id) asg ON ((asg.vehiculo_id = v.id)));

drop function if exists sgc.es_contexto_demo();
commit;
