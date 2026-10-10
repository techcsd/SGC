-- 2026-10-09-ck14-mis-trabajos-chofer.sql   ⚠️ LO APLICA EL PADRE (SGC) — regla 18/19
-- CK14 (app 2.46.0) — "Mis trabajos" del CHOFER. Cierra un HUECO del contrato CK15:
--   • `trabajos_transporte_listado` está gated a `es_flota_elevado()` (bandeja de Misael).
--   • `apoyo_transporte_listado` / `apoyo_transporte_detalle` gatean por `puede_ver_apoyo`,
--     que NO incluye al chofer asignado.
--   • la RLS base de `solicitudes_movimiento` tampoco incluye al chofer asignado.
-- → El chofer NO tiene forma de LEER los tickets que Misael le asignó, ni de SUBIR la
--   foto de "Terminé" (la policy de storage de apoyo-transporte también usa puede_ver_apoyo).
--   El write de eventos (`trabajo_evento_chofer`) SÍ es callable por el chofer (chequea
--   solo auth.uid()), así que reportar "Voy en camino/Llegué/…" ya funciona hoy.
--
-- Este archivo añade, de forma ADITIVA y segura:
--   1) `mis_trabajos_chofer(p_dia)` — lectura unificada (apoyos + actividades manuales +
--      conduces/requisiciones) ACOTADA al chofer que llama (conductores.usuario_id=auth.uid()),
--      enriquecida con solicitante+teléfono, nota, fotos y el ÚLTIMO evento del propio chofer
--      (para que la app sepa el siguiente botón válido). Espejo del `trabajos_transporte_listado`
--      pero con gate de chofer en vez de elevado.
--   2) extiende `puede_ver_apoyo` para incluir al CHOFER ASIGNADO → habilita leer/firmar las
--      fotos del apoyo y SUBIR la foto de "Terminé" a apoyo-transporte/<solicitud_id>/…
--      (la storage policy ya existente se apoya en esta función). Re-creada con su cuerpo vivo
--      + una sola cláusula (regla 19).
--
--   node scripts/apply-migration.mjs sql/2026-10-09-ck14-mis-trabajos-chofer.sql --env dev

begin;

-- 1) ¿Quién puede ver un apoyo? + CK14: el chofer ASIGNADO (cuerpo vivo + 1 cláusula).
create or replace function sgc.puede_ver_apoyo(p_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.solicitudes_movimiento s
    where s.id = p_id
      and (
        s.solicitante_id = auth.uid()
        or s.created_by = auth.uid()
        or sgc.es_referente_movimiento()
        or (s.proyecto_id is not null and sgc.puede_ver_proyecto(s.proyecto_id))
        -- CK14 — el chofer asignado ve SU apoyo (lista/detalle/fotos/subida de "Terminé").
        or exists (
          select 1 from sgc.conductores c
          where c.id = s.conductor_id and c.usuario_id = auth.uid()
        )
      )
  );
$function$;
grant execute on function sgc.puede_ver_apoyo(uuid) to authenticated, service_role;

-- 2) "Mis trabajos" del chofer — unión acotada al conductor que llama.
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
    -- Apoyos de transporte asignados a mí
    select 'apoyo'::text origen, s.id origen_id, s.tipo_apoyo tipo,
           coalesce(s.descripcion, s.que_se_mueve) descripcion, s.proyecto_id,
           s.dia, s.estado, s.conductor_id, null::uuid vehiculo_id, s.ruta_id,
           s.solicitante_id as solicitante_ref, null::text nota, s.created_at
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
    -- Conduces/requisiciones con chofer = yo (su estado lo gobierna el flujo del conduce)
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
