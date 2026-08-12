-- AO1 — Arquitectura SEGURA de la key de Google Maps (decisión: migrar a Google Maps).
--
-- Contexto/inventario (PROMPT-9 FASE 1):
--   • La key de Google (una sola "Maps Platform API Key" general) vivía SOLO en el
--     archivo local `maps_platform_api_key.env` de Xaviel — NUNCA se commiteó al repo
--     (grep de todo el historial de git = 0 coincidencias `AIza…`). No hay fuga (AG1).
--   • En prod, `sgc.parametros.google_maps_api_key` estaba VACÍO y la RPC `maps_api_key()`
--     no tenía ningún llamador cliente (scaffolding dormido). Además concedía execute a
--     `anon` → cualquiera sin sesión podía leerla. Eso se corrige aquí.
--   • El clima NO usa esta key (Open-Meteo, sin key); el geocoding tampoco (Nominatim).
--     El único consumidor server-side hoy es `routing-directions` (secreto de edge
--     `GOOGLE_MAPS_API_KEY`). Places search se suma como server-side en AO2.
--
-- Modelo de dos keys (documentado en docs/google-maps-cloud-checklist.md):
--   1) KEY SERVIDOR  → secreto de Supabase `GOOGLE_MAPS_API_KEY` (NUNCA sale al cliente).
--      APIs: Places API (New), Geocoding, Directions. Restringida por API (sin referrer).
--      La usan las edge functions: routing-directions, places-search, resolve-maps-link.
--   2) KEY NAVEGADOR → `sgc.parametros.google_maps_browser_key`. Es pública por naturaleza
--      (viaja en la URL del <script> del Maps JS SDK) PERO restringida por HTTP referrer
--      (web) y package+SHA-1 (Android). SOLO "Maps JavaScript API". Se sirve por RPC a
--      clientes AUTENTICADOS (los mapas están todos detrás de login).
--
-- Mientras `google_maps_browser_key` esté VACÍA, la RPC devuelve NULL. IMPORTANTE:
-- tras retirar Leaflet, el mapa quedará en blanco si la key no está configurada → el
-- deploy de la web debe hacerse DESPUÉS de que Xaviel cree/restrinja la key navegador
-- y la cargue (checklist de Cloud Console). Ver docs/google-maps-cloud-checklist.md.

set search_path = sgc, public;

-- Nueva parametro: la key de NAVEGADOR (restringida por referrer / package+SHA-1).
insert into sgc.parametros (clave, valor, descripcion)
values (
  'google_maps_browser_key',
  '',
  'AO1: API key de Google Maps JS para el CLIENTE (web/app). Restringida por HTTP referrer (web) y package+SHA-1 (Android), SOLO "Maps JavaScript API". Vacío = mapa deshabilitado hasta configurarla.'
)
on conflict (clave) do nothing;

-- Aclara la semántica de la parametro legacy (ahora es referencia; el server usa el
-- secreto de edge GOOGLE_MAPS_API_KEY, no esta fila).
update sgc.parametros
   set descripcion = 'AO1 (legacy AG10): antigua key única. El servidor usa el secreto de edge GOOGLE_MAPS_API_KEY; el cliente usa google_maps_browser_key. No poner la key general aquí.'
 where clave = 'google_maps_api_key';

-- RPC endurecida: devuelve la key de NAVEGADOR (fallback a la legacy por compat) a
-- clientes AUTENTICADOS. Se le quita el grant a `anon` (los mapas requieren sesión).
create or replace function sgc.maps_api_key()
returns text
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(
           nullif((select valor from sgc.parametros where clave = 'google_maps_browser_key'), ''),
           nullif((select valor from sgc.parametros where clave = 'google_maps_api_key'), '')
         );
$function$;

revoke execute on function sgc.maps_api_key() from anon;
grant execute on function sgc.maps_api_key() to authenticated, service_role;

comment on function sgc.maps_api_key() is
  'AO1: devuelve la key de NAVEGADOR de Google Maps JS (restringida por referrer/package). Solo authenticated. NULL = mapa deshabilitado.';
