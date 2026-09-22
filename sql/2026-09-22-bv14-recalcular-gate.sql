-- BV14 — Raykler bloqueado al editar echadas. recalcular_estados_combustible() estaba
-- gateada a is_admin() pero editar_echada/sanear_echada (es_flota_elevado) la llaman con
-- perform → regla 14 violada. Gate → es_flota_elevado() + error humano 22023 (regla 16).
-- Nota #63: "in 'Registro de echadas' raykler must have access to do that, no restriction to it."
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv14-recalcular-gate.sql --env dev  →  --env prod
-- Rollback: re-crear con gate is_admin() (definición previa en aw3-combustible-rpcs.sql).
begin;
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION sgc.recalcular_estados_combustible()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_count int := 0; r record;
  v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso_c numeric; v_techo_c numeric; v_min_reg int;
  v_estado text; v_motivo text; v_dir text; v_ep boolean;
begin
  if not sgc.es_flota_elevado() then raise exception 'Tu rol no puede recalcular el histórico de combustible' using errcode = '22023'; end if;
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) as ep
      from sgc.registros_combustible
     where vehiculo_id is not null and not coalesce(invalidada, false)
     order by vehiculo_id, coalesce(es_prueba,false), kilometraje
  loop
    v_ep := r.ep;
    select coalesce(medida_uso,'km'), rendimiento_esperado_km_gal into v_medida, v_esperado
      from sgc.vehiculos where id = r.vehiculo_id;
    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'), 3);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'), 0.05);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'), 1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'), 50);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = r.vehiculo_id and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_ep
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;

    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true);

    update sgc.registros_combustible
       set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal')
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
commit;
