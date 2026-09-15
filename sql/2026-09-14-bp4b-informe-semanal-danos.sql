-- ============================================================================
-- PROMPT-48 (BP) — BP4 (cont.): Sección "Daños" en el Informe semanal de obra.
-- Ronda 14/09/2026. Aditivo, idempotente, retrocompatible.
--
-- La bitácora ya captura daños de material / equipo propio (sgc.bitacora_danos,
-- migración 2026-09-14-bp4-bitacora-danos.sql). Aquí los sumamos al auto-compilado
-- del informe semanal (secciones->'danos') para que Gerencia los vea en el PDF y
-- en la pantalla de Informes (AT11 — toda data enviada es visualizable). Solo
-- extiende `compilar_informe_semanal`; no toca datos ni contratos existentes.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-14-bp4b-informe-semanal-danos.sql
-- ============================================================================
set search_path = sgc, public;

create or replace function sgc.compilar_informe_semanal(
  p_proyecto_id uuid, p_periodo_inicio date, p_periodo_fin date
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare
  v_id uuid; v_av record; v_sec jsonb; v_fotos jsonb; v_incidentes jsonb; v_nc_crit jsonb;
  v_nc_abiertas int; v_nc_cerradas int; v_pedidos int; v_horas numeric; v_pruebas int; v_bitas int;
  v_danos jsonb;
begin
  select * into v_av from sgc.calcular_avance_obra(p_proyecto_id);

  select count(*) into v_nc_abiertas from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado in ('abierta','en_correccion');
  select count(*) into v_nc_cerradas from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado = 'cerrada'
      and cerrada_en::date between p_periodo_inicio and p_periodo_fin;

  select coalesce(jsonb_agg(jsonb_build_object('titulo', coalesce(titulo, descripcion), 'severidad', severidad, 'tipo', tipo)), '[]'::jsonb)
    into v_nc_crit from sgc.obra_no_conformidades
    where proyecto_id = p_proyecto_id and estado in ('abierta','en_correccion') and severidad in ('alta','critica');

  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'descripcion', descripcion, 'gravedad', gravedad, 'fecha', fecha)), '[]'::jsonb)
    into v_incidentes from sgc.obra_incidentes
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(*) into v_pedidos from sgc.solicitudes_material
    where proyecto_id = p_proyecto_id and (urgencia = 'urgente' or estado = 'pendiente');

  select coalesce(sum(horas_hombre), 0) into v_horas from sgc.obra_mano_obra
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(*) into v_pruebas from sgc.obra_pruebas_campo
    where proyecto_id = p_proyecto_id and fecha between p_periodo_inicio and p_periodo_fin;

  select count(distinct b.id) into v_bitas from sgc.bitacoras b
    where b.proyecto_id = p_proyecto_id and b.fecha between p_periodo_inicio and p_periodo_fin;

  -- Fotos de las bitácoras de la semana (hasta 12, solo imágenes).
  select coalesce(jsonb_agg(x.url), '[]'::jsonb) into v_fotos from (
    select ba.url from sgc.bitacora_archivos ba
    join sgc.bitacoras b on b.id = ba.bitacora_id
    where b.proyecto_id = p_proyecto_id and b.fecha between p_periodo_inicio and p_periodo_fin
      and coalesce(ba.tipo_mime,'') like 'image/%'
    order by ba.created_at desc limit 12
  ) x;

  -- BP4 — daños de material / equipo propio reportados en las bitácoras de la semana.
  select coalesce(jsonb_agg(d order by d->>'fecha' desc), '[]'::jsonb) into v_danos
  from (
    select jsonb_build_object(
             'tipo', bd.tipo,
             'descripcion', coalesce(nullif(trim(bd.nombre_libre),''), a.nombre, 'Material / equipo'),
             'cantidad', bd.cantidad,
             'unidad', bd.unidad,
             'tiene_foto', coalesce(array_length(bd.fotos_paths, 1), 0) > 0,
             'solicita_retiro', bd.solicita_retiro,
             'fecha', b.fecha
           ) as d
    from sgc.bitacora_danos bd
    join sgc.bitacoras b on b.id = bd.bitacora_id
    left join sgc.articulos a on a.id = bd.articulo_id
    where b.proyecto_id = p_proyecto_id
      and b.fecha between p_periodo_inicio and p_periodo_fin
      and not bd.es_prueba
  ) t;

  v_sec := jsonb_build_object(
    'avance_plan_pct', v_av.avance_plan_pct,
    'avance_real_pct', v_av.avance_real_pct,
    'nc_abiertas', v_nc_abiertas,
    'nc_cerradas', v_nc_cerradas,
    'nc_criticas', v_nc_crit,
    'incidentes', v_incidentes,
    'pedidos_pendientes', v_pedidos,
    'horas_hombre', v_horas,
    'pruebas_campo', v_pruebas,
    'bitacoras', v_bitas,
    'fotos', v_fotos,
    'danos', v_danos
  );

  insert into sgc.informes_semanales
    (proyecto_id, fecha, periodo_inicio, periodo_fin, secciones, avance_pct, estado, creado_por)
  values
    (p_proyecto_id, current_date, p_periodo_inicio, p_periodo_fin, v_sec, v_av.avance_real_pct, 'borrador', auth.uid())
  on conflict (proyecto_id, periodo_inicio, periodo_fin) where periodo_inicio is not null
  do update set
    secciones = excluded.secciones,
    avance_pct = excluded.avance_pct
  where sgc.informes_semanales.estado = 'borrador'
  returning id into v_id;

  -- Si el conflicto era un informe ya enviado, no se actualiza: recupera su id.
  if v_id is null then
    select id into v_id from sgc.informes_semanales
      where proyecto_id = p_proyecto_id and periodo_inicio = p_periodo_inicio and periodo_fin = p_periodo_fin;
  end if;
  return v_id;
end $$;
grant execute on function sgc.compilar_informe_semanal(uuid,date,date) to authenticated, service_role;
