-- 2026-10-09-ck16-chofer-nota-apoyo.sql   ⚠️ LO APLICA EL PADRE (SGC) — regla 18/19
-- CK16 (polish del contrato CK14/CK15) — `mis_trabajos_chofer` ya existe y la columna
-- `solicitudes_movimiento.nota_chofer` también (CK15). Esta recreación hace que la rama
-- de APOYOS devuelva `s.nota_chofer` (antes `null`), para que el chofer vea la nota que
-- Misael le dejó al asignar también en los apoyos (hoy solo la ve en los manuales).
--
-- Regla 19: `mis_trabajos_chofer` es idéntica en prod y dev (verificado por md5) — no hay
-- divergencia por `es_usuario_demo` (es una función nueva de CK14). Cambio de UNA línea.
--
--   node scripts/apply-migration.mjs sql/2026-10-09-ck16-chofer-nota-apoyo.sql --env dev

begin;

create or replace function sgc.mis_trabajos_chofer(p_dia date default null)
returns setof jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with yo as (
    select coalesce(array_agg(c.id), '{}'::uuid[]) as cond_ids, auth.uid() as uid
    from sgc.conductores c where c.usuario_id = auth.uid()
  ),
  t as (
    -- Apoyos de transporte asignados a mí (CK16 — ahora incluye la nota del asignador)
    select 'apoyo'::text origen, s.id origen_id, s.tipo_apoyo tipo,
           coalesce(s.descripcion, s.que_se_mueve) descripcion, s.proyecto_id,
           s.dia, s.estado, s.conductor_id, null::uuid vehiculo_id, s.ruta_id,
           s.solicitante_id as solicitante_ref, s.nota_chofer nota, s.created_at
      from sgc.solicitudes_movimiento s, yo
     where s.conductor_id = any(yo.cond_ids)
       and coalesce(s.es_prueba,false) = false
    union all
    -- Actividades manuales que Misael me puso
    select 'manual'::text, m.id, 'actividad'::text, m.descripcion, m.proyecto_id,
           m.dia, m.estado, m.conductor_id, m.vehiculo_id, m.ruta_id,
           m.creado_por, m.nota, m.created_at
      from sgc.trabajos_manual m, yo
     where m.conductor_id = any(yo.cond_ids)
    union all
    -- Conduces/requisiciones con chofer = yo
    select 'requisicion'::text, si.id, 'conduce'::text, 'Conduce asignado'::text, si.proyecto_id,
           si.fecha, si.estado, si.conductor_id, si.vehiculo_id, si.ruta_id,
           null::uuid, null::text, si.created_at
      from sgc.salidas_inventario si, yo
     where si.conductor_id = any(yo.cond_ids) and si.anulado_por is null
       and coalesce(si.es_prueba,false) = false
  )
  select jsonb_build_object(
    'origen', t.origen, 'origen_id', t.origen_id, 'tipo', t.tipo,
    'descripcion', t.descripcion, 'proyecto_id', t.proyecto_id, 'proyecto', p.nombre,
    'dia', t.dia, 'estado', t.estado, 'conductor_id', t.conductor_id,
    'vehiculo_id', t.vehiculo_id, 'ruta_id', t.ruta_id,
    'solicitante', u.nombre, 'solicitante_telefono', coalesce(u.telefono, ''),
    'nota', t.nota, 'created_at', t.created_at,
    'fotos', coalesce((
        select jsonb_agg(f.path order by f.created_at)
        from sgc.apoyo_transporte_fotos f
        where t.origen = 'apoyo' and f.solicitud_id = t.origen_id
      ), '[]'::jsonb),
    'ultimo_evento', (
        select e.evento from sgc.trabajo_eventos e, yo
        where e.origen = t.origen and e.origen_id = t.origen_id and e.por = yo.uid
        order by coalesce(e.hora_cliente, e.created_at) desc limit 1
      )
  )
  from t
  left join sgc.proyectos p on p.id = t.proyecto_id
  left join sgc.usuarios  u on u.id = t.solicitante_ref
  where (p_dia is null or t.dia = p_dia)
  order by t.created_at desc;
$function$;
grant execute on function sgc.mis_trabajos_chofer(date) to authenticated, service_role;

commit;
