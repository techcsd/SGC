# Google Maps — Checklist de configuración (AO1) · para Xaviel

Migración de mapas Leaflet → **Google Maps** (decisión tomada 12/08/2026). Este documento
es la lista de pasos MANUALES que debes hacer en **Google Cloud Console**, Supabase y
Vercel para activar los mapas y la búsqueda de lugares de forma **segura**. Claude Code ya
dejó todo el código y las migraciones listos; **nada se ha desplegado ni commiteado** — el
deploy depende de que completes esto primero.

> ⚠️ **Nunca pongas una API key en el repo.** El historial de git está limpio (verificado).
> El archivo `maps_platform_api_key.env` ya está en `.gitignore` (antes NO lo estaba —
> corregido). No lo borres todavía: tiene el valor de la key que necesitas abajo. Bórralo
> cuando termines de configurar los secretos.

---

## 1. El modelo de DOS keys (por qué)

Poner la key en el front end (como estaba pensado) es inseguro. Se separan en dos:

| Key | Vive en | La usa | Restricción |
|-----|---------|--------|-------------|
| **SERVIDOR** | Secreto de Supabase `GOOGLE_MAPS_API_KEY` (NUNCA en el cliente) | Edge functions: `places-search`, `routing-directions`, `resolve-maps-link` | Por **API** (Places, Geocoding, Directions). Sin referrer. |
| **NAVEGADOR** | Fila `sgc.parametros.google_maps_browser_key` (la sirve la RPC `maps_api_key()` a usuarios autenticados) | El mapa JS del navegador/app | Por **HTTP referrer** (web) y **package + SHA‑1** (Android). Solo "Maps JavaScript API". |

La key de navegador es pública por naturaleza (viaja en la URL del `<script>`), pero al estar
restringida por referrer no sirve fuera de tu dominio → es la práctica estándar de Google.

**Hoy** tienes UNA sola key general (`AIzaSy…agvKk`) sin restricciones, con Places/Geocoding/
Directions habilitadas. Recomendación: convertirla en la **key de servidor** (agrégale
restricción por API) y **crear una key nueva de navegador**.

---

## 2. APIs a habilitar (Cloud Console → APIs y servicios → Biblioteca)

- **Maps JavaScript API**  → para el mapa del navegador (key de NAVEGADOR).
- **Places API (New)**     → búsqueda de lugares (key de SERVIDOR). *(el código usa la New v1)*
- **Geocoding API**        → dirección ↔ coordenadas (key de SERVIDOR).
- **Directions API**       → distancia/tiempo de rutas (key de SERVIDOR, ya en uso).

## 3. Crear/restringir las keys (Cloud Console → Credenciales)

**Key de SERVIDOR** (la actual):
1. Restricciones de aplicación: **Ninguna** (o por IP si quieres; las edge functions de
   Supabase no tienen IP fija, así que deja "Ninguna").
2. Restricciones de API: **Places API (New)**, **Geocoding API**, **Directions API**.

**Key de NAVEGADOR** (nueva):
1. Restricciones de aplicación → **Sitios web (HTTP referrers)**. Agrega:
   - `https://sgcconstructorasd.com/*`
   - `https://*.vercel.app/*`  (deploys de preview)
   - `http://localhost:*/*`  (dev)
   - Para la app Android (WebView de Capacitor): agrega también `https://localhost/*`.
   - *(Cuando publiquen la app nativa, además crear una key Android con package + SHA‑1.)*
2. Restricciones de API: **solo Maps JavaScript API**.

## 4. Guardar las keys donde van

- **Key de SERVIDOR** → secreto de Supabase (dashboard → Edge Functions → Secrets, o CLI):
  ```
  supabase secrets set GOOGLE_MAPS_API_KEY=<key_servidor>
  ```
  (Ya existe con la key general; solo confirma que sigue siendo válida tras restringirla.)
- **Key de NAVEGADOR** → tabla `sgc.parametros`, clave `google_maps_browser_key`
  (Administración o SQL). Mientras esté vacía, el mapa se muestra deshabilitado con aviso
  (no rompe la página). Ejemplo SQL:
  ```sql
  update sgc.parametros set valor = '<key_navegador>' where clave = 'google_maps_browser_key';
  ```
- **No hace falta** poner ninguna key en Vercel: el navegador la obtiene por la RPC.

## 5. Desplegar la edge function nueva

```
supabase functions deploy places-search
```

## 6. Orden de encendido (importante)

1. Habilita APIs + crea/restringe las 2 keys.
2. `GOOGLE_MAPS_API_KEY` (servidor) en Supabase + `supabase functions deploy places-search`.
3. `google_maps_browser_key` (navegador) en `sgc.parametros`.
4. **Recién entonces** desplegar la web (Leaflet ya fue retirado; sin la key de navegador
   configurada, el mapa saldría en blanco con el aviso).

## 7. Billing / consumo estimado

- Google da **$200/mes de crédito gratis** (cubre miles de cargas). Debes tener **billing
  activo** en el proyecto o las APIs responden `REQUEST_DENIED`.
- Uso esperado SGC (bajo): Maps JS ~ cargas de mapa por sesión (Seguimiento/pin de obra);
  Places autocomplete se cobra por **sesión** (autocomplete + details = 1 sesión, ya se usa
  session token en el código para minimizar costo); Geocoding/Directions puntuales.
- Recomendado: pon **cuotas/alertas de presupuesto** en Cloud Console (ej. tope diario de
  requests por API) para evitar sorpresas.

## 8. Rotación

Si alguna vez una key se filtra: crea una nueva, actualiza el secreto/parametro
correspondiente, y borra la vieja en Cloud Console. El código no necesita cambios
(las keys no están hardcodeadas).
