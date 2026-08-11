-- =============================================================================
-- PROMPT-5 FASE 3 (AM5 + AM6) — Ronda 11/08/2026 (IDs AM). SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- AM5 — "tras crear un conduce no sale en ruta". Causa: la auto-ruta (AF23) solo
--   se crea cuando hay proyecto_id + vehiculo_id + conductor a la vez. Un conduce
--   sin vehículo, o una devolución a suplidor (sin obra destino), NO genera ruta →
--   no aparece en "Mis rutas" y no se puede "Iniciar ruta". FIX: RPC que arranca
--   una ruta desde CUALQUIER conduce emitido (usa la ruta existente, o crea una y
--   la adjunta), y lista de "Conduces por entregar" enriquecida con estado de ruta.
--
-- AM6 — auditoría end-to-end (el informe va en el resumen). Aquí dejamos el
--   contrato de datos que la app y la web necesitan para pintar el ciclo completo.
-- =============================================================================

begin;

-- ── 1) Iniciar (o crear+iniciar) la ruta de un conduce ───────────────────────
-- Portador del conduce (o flota/inventario/admin). Si el conduce ya tiene ruta
-- planificada, la arranca; si no tiene ruta (o quedó completada/cancelada), crea
-- una nueva tipo 'material' con una parada = destino y la adjunta. Requiere un
-- vehículo: usa el del conduce o el que se pase.
create or replace function sgc.conduce_iniciar_ruta(
  p_salida_id uuid, p_vehiculo_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_s sgc.salidas_inventario%rowtype;
  v_es_portador boolean; v_elevado boolean;
  v_ruta uuid; v_ruta_estado text; v_veh uuid;
  v_origen text; v_destino text; v_orden int; v_parada uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_s from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  v_es_portador := exists (select 1 from sgc.conductores c where c.id = v_s.conductor_id and c.usuario_id = v_uid);
  v_elevado := sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario');
  if not (v_es_portador or v_elevado) then
    raise exception 'Solo el chofer responsable del conduce puede iniciar su ruta.';
  end if;
  if v_s.recibido_por is not null or coalesce(v_s.estado,'') in ('entregado','entregado_incompleto','anulado') then
    raise exception 'Este conduce ya no está pendiente de entrega.';
  end if;

  -- ¿Hay ya una ruta reutilizable?
  if v_s.ruta_id is not null then
    select estado into v_ruta_estado from sgc.rutas where id = v_s.ruta_id;
    if v_ruta_estado in ('planificada','en_curso') then
      v_ruta := v_s.ruta_id;
    end if;
  end if;

  -- Crear+adjuntar una ruta nueva si no hay reutilizable.
  if v_ruta is null then
    v_veh := coalesce(v_s.vehiculo_id, p_vehiculo_id);
    if v_veh is null then
      raise exception 'Selecciona un vehículo para iniciar la ruta de este conduce.'
        using errcode = 'DR461';
    end if;
    if v_s.conductor_id is null then
      raise exception 'El conduce no tiene chofer asignado; no se puede iniciar la ruta.'
        using errcode = 'DR462';
    end if;
    select coalesce(nombre,'Almacén') into v_origen from sgc.bodegas where id = v_s.bodega_id;
    v_destino := coalesce(
      (select nombre from sgc.proyectos where id = v_s.proyecto_id),
      (select nombre from sgc.bodegas where id = v_s.destino_almacen_id),
      case when v_s.motivo = 'devolucion' then 'Devolución a suplidor' else 'Entrega' end);

    insert into sgc.rutas (
      vehiculo_id, conductor_id, origen, destino, destino_proyecto_id, fecha, tipo,
      estado, creado_por, es_prueba, es_prueba_origen, iniciada_at)
    values (
      v_veh, v_s.conductor_id, coalesce(v_origen,'Almacén'), v_destino, v_s.proyecto_id,
      current_date, 'material', 'en_curso', v_uid,
      coalesce(v_s.es_prueba,false), case when coalesce(v_s.es_prueba,false) then 'heredado' else 'manual' end,
      now())
    returning id into v_ruta;

    select coalesce(max(orden),0)+1 into v_orden from sgc.ruta_paradas where ruta_id = v_ruta;
    insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, proyecto_id, estado)
    values (v_ruta, v_orden, v_destino, v_s.proyecto_id, 'pendiente')
    returning id into v_parada;

    update sgc.salidas_inventario
       set ruta_id = v_ruta, ruta_parada_id = coalesce(ruta_parada_id, v_parada),
           vehiculo_id = coalesce(vehiculo_id, v_veh)
     where id = p_salida_id;
  else
    -- Arrancar la ruta existente si estaba planificada.
    update sgc.rutas
       set estado = 'en_curso', iniciada_at = coalesce(iniciada_at, now()), updated_at = now()
     where id = v_ruta and estado = 'planificada';
  end if;

  return jsonb_build_object(
    'ruta_id', v_ruta,
    'estado', (select estado from sgc.rutas where id = v_ruta),
    'fase', sgc.conduce_fase(p_salida_id));
end;
$$;
grant execute on function sgc.conduce_iniciar_ruta(uuid, uuid) to authenticated, service_role;
comment on function sgc.conduce_iniciar_ruta(uuid, uuid) is
  'AM5 — arranca la ruta de un conduce: reutiliza la ruta planificada/en curso o crea+adjunta una nueva (incluye devolución a suplidor). El conduce pasa a aparecer en Mis rutas (mis_rutas_hoy) y en Seguimiento.';

-- ── 2) "Pendiente entrega" enriquecido con estado de ruta (para Mis rutas) ────
-- Añade ruta_id / ruta_estado / vehiculo_id / motivo / tiene_ruta a la lista para
-- que la app decida "Iniciar ruta" vs "En ruta". Columnas nuevas → los callers
-- viejos (web) las ignoran. Mantiene el orden y filtros de AL13.
drop function if exists sgc.mis_conduces_pendientes_entrega();
create or replace function sgc.mis_conduces_pendientes_entrega()
returns table (
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text,
  estado text, fase text, created_at timestamptz,
  ruta_id uuid, ruta_estado text, vehiculo_id uuid, motivo text, tiene_ruta boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id,
         coalesce(p.nombre, ba.nombre,
                  case when s.motivo='devolucion' then 'Devolución a suplidor' else null end) as destino,
         b.nombre, s.estado, sgc.conduce_fase(s.id), s.created_at,
         s.ruta_id, r.estado, s.vehiculo_id, s.motivo, (s.ruta_id is not null)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.rutas     r on r.id = s.ruta_id
  where (
          s.conductor_id in (select sgc.mis_conductor_ids())
          or (s.creado_por = auth.uid()
              and (s.conductor_id is null
                   or s.conductor_id in (select sgc.mis_conductor_ids())))
        )
    and coalesce(s.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and s.recibido_por is null
    and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
  order by s.created_at desc;
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega() to authenticated, service_role;

create or replace function sgc.mis_conduces_pendientes_entrega_count()
returns integer
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::int from sgc.mis_conduces_pendientes_entrega();
$$;
grant execute on function sgc.mis_conduces_pendientes_entrega_count() to authenticated, service_role;

commit;
