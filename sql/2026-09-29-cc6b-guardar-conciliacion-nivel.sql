-- ============================================================================
-- CC6b (PROMPT-74 F5) — guardar_conciliacion_combustible persiste el nivel/causa
-- del match y ENLAZA la factura. Sin esto (AT11): el frontend manda nivel_match/
-- causa_sin_match pero el INSERT los descartaba (columna explícita) → el panel de
-- causas mostraría "sin_clasificar"; y sin factura_id la vista "vigente" no puede
-- contar 1 factura = 1 (las re-subidas doblan el conteo).
-- Cambios (aditivos): + factura_id en el header, + nivel_match/causa_sin_match en
-- el detalle. Todo lo demás igual que la versión viva.
-- BU1 (regla 18): --env dev primero, luego --env prod --yes.
-- ============================================================================

begin;

create or replace function sgc.guardar_conciliacion_combustible(p_meta jsonb, p_detalles jsonb)
returns uuid language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_discrepancias int;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado para guardar conciliaciones de combustible.';
  end if;

  insert into sgc.conciliaciones_combustible (
    estacion, fecha_desde, fecha_hasta, nombre_archivo,
    total_informe_filas, total_matches, total_solo_plataforma, total_solo_informe, total_diferencias,
    monto_plataforma, monto_informe, galones_plataforma, galones_informe, notas, pdf_path, factura_id, creado_por
  ) values (
    coalesce(p_meta->>'estacion','Total Energies'),
    nullif(p_meta->>'fecha_desde','')::date, nullif(p_meta->>'fecha_hasta','')::date,
    p_meta->>'nombre_archivo',
    coalesce((p_meta->>'total_informe_filas')::int,0),
    coalesce((p_meta->>'total_matches')::int,0),
    coalesce((p_meta->>'total_solo_plataforma')::int,0),
    coalesce((p_meta->>'total_solo_informe')::int,0),
    coalesce((p_meta->>'total_diferencias')::int,0),
    coalesce((p_meta->>'monto_plataforma')::numeric,0),
    coalesce((p_meta->>'monto_informe')::numeric,0),
    coalesce((p_meta->>'galones_plataforma')::numeric,0),
    coalesce((p_meta->>'galones_informe')::numeric,0),
    p_meta->>'notas', nullif(p_meta->>'pdf_path',''),
    nullif(p_meta->>'factura_id','')::uuid, auth.uid()
  ) returning id into v_id;

  insert into sgc.conciliacion_combustible_detalle (
    conciliacion_id, tipo, registro_id, vehiculo_id, identificador, fecha,
    galones_plataforma, galones_informe, monto_plataforma, monto_informe,
    diferencia_galones, diferencia_monto, nivel_match, causa_sin_match
  )
  select v_id, d->>'tipo',
         nullif(d->>'registro_id','')::uuid, nullif(d->>'vehiculo_id','')::uuid,
         d->>'identificador', nullif(d->>'fecha','')::date,
         nullif(d->>'galones_plataforma','')::numeric, nullif(d->>'galones_informe','')::numeric,
         nullif(d->>'monto_plataforma','')::numeric, nullif(d->>'monto_informe','')::numeric,
         nullif(d->>'diferencia_galones','')::numeric, nullif(d->>'diferencia_monto','')::numeric,
         nullif(d->>'nivel_match',''), nullif(d->>'causa_sin_match','')
  from jsonb_array_elements(p_detalles) as d;

  v_discrepancias := coalesce((p_meta->>'total_diferencias')::int,0)
                   + coalesce((p_meta->>'total_solo_plataforma')::int,0)
                   + coalesce((p_meta->>'total_solo_informe')::int,0);

  if v_discrepancias > 0 then
    insert into sgc.avisos_flota (tipo, mensaje, severidad, dedup_key)
    values ('conciliacion',
            format('Conciliación de combustible %s: %s discrepancia(s) detectada(s).',
                   coalesce(p_meta->>'estacion','Total Energies'), v_discrepancias),
            'alta', 'conciliacion:' || v_id::text)
    on conflict (dedup_key) do nothing;
  end if;

  return v_id;
end;
$function$;

commit;
