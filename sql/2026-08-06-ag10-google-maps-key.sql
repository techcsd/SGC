-- AG10 — Google Maps: la app (y la web) cargan el mapa con una API key de Google
-- Maps JS. Lección AG1: la key NUNCA vive en el repo → se guarda en sgc.parametros
-- y se sirve por RPC a los clientes autenticados. La key es pública por naturaleza
-- (viaja en la URL del script) pero DEBE restringirse por referrer en la consola:
-- https://app.sgcconstructorasd.com/*, https://localhost/* (WebView Android) y el
-- localhost de dev; y limitarse a "Maps JavaScript API".
--
-- Mientras el valor esté VACÍO, la app usa Leaflet (fallback) → cero regresión.

set search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion)
values (
  'google_maps_api_key',
  '',
  'AG10: API key de Google Maps JS (restringida por referrer + Maps JS API). Vacío = la app usa Leaflet como fallback.'
)
on conflict (clave) do nothing;

-- RPC de solo lectura para clientes autenticados: devuelve la key o NULL si no está
-- configurada (la app cae a Leaflet). No expone el resto de sgc.parametros.
create or replace function sgc.maps_api_key()
returns text
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select nullif(valor, '') from sgc.parametros where clave = 'google_maps_api_key';
$function$;

grant execute on function sgc.maps_api_key() to authenticated, anon, service_role;
