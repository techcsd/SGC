# Contratos para PROMPT-10 (csd-app) — Ronda AO (12/08/2026)

Backend/web ya listo en SGC (padre). La app (hijo) consume estos contratos. Todo aditivo y
retrocompatible. **Requiere que Xaviel complete el checklist de Google Cloud** (ver
[`docs/google-maps-cloud-checklist.md`](./docs/google-maps-cloud-checklist.md)) y que se
apliquen las migraciones `sql/2026-08-12-ao*.sql` + se despliegue la edge `places-search`.

## 1. Mapas Google + búsqueda de lugares (AO1/AO2)

- **Key del mapa (navegador)**: RPC `sgc.maps_api_key()` → devuelve la key de navegador
  restringida (o `null` si no configurada → mostrar fallback). Solo `authenticated`.
  La app carga el SDK de Google Maps con esa key (referrer/package restringido).
- **Búsqueda de lugares**: edge function **`places-search`** (key de servidor, RD region
  bias). Body:
  - `{ action: 'autocomplete', input, sessionToken? }` → `{ predictions: [{ placeId, primary, secondary, description }] }`
  - `{ action: 'details', placeId, sessionToken? }` → `{ name, lat, lng, address }`
  - `{ action: 'text', input, lat?, lng? }` → `{ results: [{ placeId, name, lat, lng, address }] }`
  - Usa `sessionToken` (un UUID por sesión de búsqueda, igual en autocomplete y details)
    para agrupar el costo. Reemplaza al buscador anterior (Nominatim) en TODOS los
    selectores de ubicación (crear conduce origen "Otros"/destino, ubicación de obra, pins).
- **Resolver link de Maps / coordenadas** (sin cambios): edge `resolve-maps-link`.
- Los contratos de datos de tracking NO cambian (breadcrumb/polylines `[lat,lng][]`,
  `chofer_ultima_posicion`, `ruta_trayecto`, `ruta_breadcrumb_vivo`). Solo migra el render.

## 2. Permiso "comparte ubicación" por rol/usuario (AO6)

- **`sgc.mi_comparte_ubicacion()` → boolean**: el onboarding de permisos de la app llama
  esto. Si `false`, **NO pedir permiso de ubicación** ni mostrar banners/bloqueos de GPS
  (Eduardo NG y roles de oficina/gerencia). Si `true`, pedir ubicación como siempre.
- **`sgc.comparte_ubicacion(p_uid uuid)` → boolean**: consulta genérica (para el otro lado).
- **Regla de servidor**: `sgc.registrar_posiciones(jsonb)` ahora RECHAZA
  (`errcode 42501`, "Sin permiso para registrar posición") a quien no comparte ubicación.
  La app solo debe intentar enviar posiciones si `mi_comparte_ubicacion()` es `true`.
- Fuente de verdad: override por usuario (`sgc.usuario_flags`, flag `comparte_ubicacion`)
  gana sobre el default por rol (`sgc.roles.comparte_ubicacion`). Default en
  `chofer_transportista`; **Misael** (jefe_flota) tiene override = true por seed.
- Verificado en prod (dry-run): Eduardo NG → false, Misael → true, un chofer → true.

## 3. Conduce PDF compartible (AO4)

- Contrato ÚNICO: **`sgc.conduce_detalle_app(p_salida_id uuid)` → jsonb** (completado con
  campos de firma legacy `entrega_receptor`, `entrega_firma_path`, `firma_path`,
  `firma_pendiente_nombre`, más `responsable`/`observaciones`). Trae número, fecha, obra,
  almacenes origen/destino, portador actual, items, firmas (canónicas + legacy),
  transferencias, fotos y notas — todo lo necesario para armar el PDF en el dispositivo.
- La app arma el PDF desde este JSON y lo comparte por el share sheet nativo (WhatsApp).
  Decisión: NO hay PDF server-side (Deno no tiene motor fiable y duplicaría el template);
  la web imprime con `window.print()` ("Guardar como PDF") sobre los mismos datos.

## 4. Submódulo Conduces (web, AO5) — referencia

- La web ya tiene el listado completo con pestañas Activos | Pendientes de entrega |
  Por confirmar | Histórico vía RPC `sgc.conduces_web_listado()` (fase + bucket). La app
  puede reusar el mismo criterio de bucket para paridad de pestañas si hace falta.
