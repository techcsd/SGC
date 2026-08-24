-- ============================================================================
-- AW3 (FASE 1.5) — Limpieza retroactiva de las 3 echadas reales absurdas.
-- Aprobado por Xaviel (Q1): corregir #1, excluir #2 y #3. Traza en
-- valor_original / saneamiento_* (nunca borrado, criterio AU18).
--
-- Universo real (no es_prueba) = 13 echadas; solo estas 3 son absurdas.
--  #1 5b8edd7e  Canter L542136   34,118 gal / RD$10k  → decimal perdido (~34.118)
--  #2 d2a5b179  KIA k2700 L473027 11.73 gal / 1405 km → 119.78 km/gal (dato)
--  #3 d7d83f01  KIA k2700 L473027 10.9 gal  / 968 km  → 88.81 km/gal (dato)
--
-- Se ejecuta con rol de servicio (fuera de la RPC sanear_echada, que exige
-- is_admin() con JWT). Replica su misma lógica + recálculo del histórico.
-- ============================================================================

begin;

-- ── #1 — CORREGIR: 34,118 → 34.118 gal (monto RD$10,000 intacto) ──────────
update sgc.registros_combustible r
   set valor_original    = coalesce(valor_original, to_jsonb(r.*)),
       galones           = 34.118,
       precio_por_galon  = round(10000::numeric / 34.118, 2),
       rendimiento_km_gal= round(km_recorridos::numeric / 34.118, 2),
       costo_por_km      = case when km_recorridos > 0 then round(10000::numeric / km_recorridos, 2) else costo_por_km end,
       saneada           = true,
       saneamiento_motivo= 'AW3: punto decimal perdido en el registro (34.118 gal ≈ RD$10,000 ÷ ~293/gal).',
       saneada_at        = now()
 where id = '5b8edd7e-c874-45c2-ae5c-db13720421bf';

-- ── #2 y #3 — INVALIDAR: rendimiento imposible por km sin echada previa ────
update sgc.registros_combustible r
   set valor_original    = coalesce(valor_original, to_jsonb(r.*)),
       invalidada        = true,
       saneada           = true,
       saneamiento_motivo= 'AW3: rendimiento imposiblemente alto (echada previa sin registrar / km inflado). Excluida de promedios/KPIs/incentivo.',
       saneada_at        = now()
 where id in ('d2a5b179-5d3a-4623-8095-d44f4d67ac03',
              'd7d83f01-d111-4418-a99c-904d6af3a68b');

-- ── Recálculo del histórico (replica recalcular_estados_combustible, sin el
--    guard is_admin, porque corre como rol de servicio) ────────────────────
do $$
declare
  r record; v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso numeric; v_techo numeric; v_min_reg int;
  v_estado text; v_motivo text; v_dir text;
begin
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) ep
      from sgc.registros_combustible
     where vehiculo_id is not null and not coalesce(invalidada,false)
     order by vehiculo_id, coalesce(es_prueba,false), kilometraje
  loop
    select coalesce(medida_uso,'km'), rendimiento_esperado_km_gal into v_medida, v_esperado
      from sgc.vehiculos where id = r.vehiculo_id;
    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'),3);
      v_piso := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'),0.05);
      v_techo := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'),1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'),50);
      v_piso := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'),10);
      v_techo := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'),35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'),3);
    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = r.vehiculo_id and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba,false)=r.ep and not coalesce(invalidada,false)
       and km_recorridos >= v_dist_min and rendimiento_km_gal between v_piso and v_techo;
    v_baseline := case when v_esperado is not null and v_esperado>0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;
    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true);
    update sgc.registros_combustible
       set estado=v_estado, motivo_alerta=v_motivo, alerta_consumo=(v_estado='anormal')
     where id = r.id;
  end loop;
end $$;

commit;
