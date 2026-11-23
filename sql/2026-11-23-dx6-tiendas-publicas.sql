-- DX6 (ronda 23-nov-2026), lado SGC -- URLs de las fichas de tienda configurables SIN tocar código y expuestas en una
-- página pública «Instalar la app». Valores vacíos por defecto (aún no hay cuentas de tienda). Solo se exponen las 2 URLs.
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('tienda_play_url', '', 'DX6 — URL de la ficha de la app en Google Play (vacío = aún no publicada). Se muestra en /instalar.'),
  ('tienda_appstore_url', '', 'DX6 — URL de la ficha (o enlace Unlisted) en App Store (vacío = aún no publicada). Se muestra en /instalar.')
on conflict (clave) do nothing;

create or replace function sgc.tiendas_publicas()
returns jsonb language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select jsonb_build_object(
    'play', nullif(trim(coalesce((select valor from sgc.parametros where clave = 'tienda_play_url'), '')), ''),
    'appstore', nullif(trim(coalesce((select valor from sgc.parametros where clave = 'tienda_appstore_url'), '')), ''));
$$;
revoke all on function sgc.tiendas_publicas() from public;
grant execute on function sgc.tiendas_publicas() to anon, authenticated;
commit;
