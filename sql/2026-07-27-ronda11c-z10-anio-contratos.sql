-- ============================================================================
-- RONDA 11c · Z10 — Exponer el AÑO del vehículo en los contratos que consume la app
-- ----------------------------------------------------------------------------
-- La columna sgc.vehiculos.anio ya existe (int NOT NULL); en la web ya se muestra
-- en cards/pickers/reportes/detalle vía descripcionVehiculo(). Falta enriquecer los
-- RPCs SECURITY DEFINER que alimentan la CSD App (PROMPT-4) para que puedan pintar
-- "Marca Modelo Año" (ej. "Izuzu D-Max 2023"). Todo aditivo:
--   · flota_placas(): se recrea añadiendo la columna `anio` (cambia el returns table).
--   · mis_pendientes_transporte(): se añade 'anio' a los objetos jsonb (sin romper).
-- Retrocompatible: los consumidores web actuales seleccionan por nombre de columna.
-- ============================================================================

set search_path = sgc, public;

-- 1) Picker de vehículos de la app / fallback de reportes (incluye inactivos). --
drop function if exists sgc.flota_placas();
create or replace function sgc.flota_placas()
returns table(id uuid, placa text, marca text, modelo text, anio int, activo boolean)
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select v.id, v.placa, v.marca, v.modelo, v.anio, coalesce(v.activo, true)
  from sgc.vehiculos v
  where (sgc.is_admin() or sgc.tiene_modulo('flota'))
    and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
$function$;
grant execute on function sgc.flota_placas() to authenticated, service_role;

-- 2) Pendientes de transporte del chofer: incluir el año en ambos bloques. -----
create or replace function sgc.mis_pendientes_transporte()
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'public'
as $function$
  select jsonb_build_object(
    'a_cargo', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entrega_id', e.id, 'vehiculo_id', v.id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo, 'anio', v.anio, 'km', e.km, 'desde', e.capturado_en)), '[]'::jsonb)
      from sgc.vehiculo_entregas e
      join sgc.vehiculos v on v.id = e.vehiculo_id
      where e.conductor_usuario_id = auth.uid() and e.tipo = 'recepcion' and e.estado = 'abierta'
        and ((not coalesce(e.es_prueba, false)) or sgc.is_admin())
        and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
    ),
    'por_recibir', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
        'modelo', v.modelo, 'anio', v.anio, 'km', v.kilometraje)), '[]'::jsonb)
      from sgc.vehiculos v
      where v.responsable_id = auth.uid() and coalesce(v.activo, true)
        and ((not coalesce(v.es_prueba, false)) or sgc.is_admin())
        and not exists (
          select 1 from sgc.vehiculo_entregas e
          where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta')
    )
  );
$function$;
grant execute on function sgc.mis_pendientes_transporte() to authenticated, service_role;
