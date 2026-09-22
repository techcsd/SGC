-- BV2 — Un vehículo se muestra siempre como "nombre · placa" (Eduardo: "por placa
-- no sé cuál es cuál"). Añade vehiculos.alias (Raykler lo llena) y la función
-- sgc.vehiculo_display() que usan TODAS las salidas humanas (edges de correo,
-- resumen semanal, notificaciones, conciliación, selects web/app).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv2-vehiculo-display.sql --env dev  →  --env prod
-- Rollback: drop function sgc.vehiculo_display(uuid); alter table sgc.vehiculos drop column alias;
begin;

alter table sgc.vehiculos add column if not exists alias text;
comment on column sgc.vehiculos.alias is 'BV2 — nombre legible del vehículo (Raykler). Si está, manda sobre marca/modelo/año en vehiculo_display().';

create or replace function sgc.vehiculo_display(p_id uuid)
returns text language sql stable as $fn$
  select case
    when v.id is null then null
    else coalesce(
      nullif(btrim(v.alias), ''),
      nullif(btrim(concat_ws(' ', v.marca, v.modelo, nullif(v.anio, 0)::text)), ''),
      'Vehículo'
    ) || case when coalesce(btrim(v.placa), '') <> '' then ' · ' || v.placa else '' end
  end
  from sgc.vehiculos v where v.id = p_id
$fn$;
grant execute on function sgc.vehiculo_display(uuid) to authenticated, anon, service_role;

commit;
