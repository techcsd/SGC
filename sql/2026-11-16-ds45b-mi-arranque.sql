-- DS-45 (#69) lado servidor del arranque: UNA llamada en vez de tres.
-- sgc.mi_arranque() agrupa lo que la app pide al abrir (preferencias, conteo de firmas pendientes y de entregas por confirmar).
-- Aditiva: no cambia ni reemplaza las RPC existentes (mis_preferencias, mis_firmas_pendientes, mis_entregas_por_confirmar),
-- que siguen siendo la fuente de verdad y respetan sus propios permisos. SECURITY INVOKER: corre con los permisos de quien llama.
-- Reversa: drop function sgc.mi_arranque();
create or replace function sgc.mi_arranque()
returns jsonb
language sql
stable
security invoker
set search_path = sgc, pg_temp
as $$
  select jsonb_build_object(
    'preferencias',              sgc.mis_preferencias(),
    'firmas_pendientes',         jsonb_array_length(sgc.mis_firmas_pendientes()),
    'entregas_por_confirmar',    (select count(*) from sgc.mis_entregas_por_confirmar()),
    'generado_en',               now()
  );
$$;
revoke all on function sgc.mi_arranque() from public, anon;
grant execute on function sgc.mi_arranque() to authenticated, service_role;
comment on function sgc.mi_arranque() is 'DS-45: arranque de la app en una sola llamada (ver docs/ARRANQUE-APP-DS45.md).';
