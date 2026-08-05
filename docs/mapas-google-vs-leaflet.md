# AG10 — Mapas: Leaflet/OSM vs Google Maps — research y recomendación

> ⏸ **PAUSA — decisión de Xaviel.** Este documento compara opciones y recomienda; **no se migra nada** en este prompt. La leyenda del mapa (AG11) ya se implementó y es independiente de esta decisión.

## Estado actual
- SGC web (`/flota/seguimiento`) y la app usan **Leaflet 1.9.4** con tiles gratuitos de **OpenStreetMap** (`tile.openstreetmap.org`). Pines `divIcon` propios (colores por estado AF28). Sin API key, sin costo, sin límite de facturación.
- La etiqueta "Leaflet" abajo-derecha es la **atribución obligatoria** de Leaflet + OSM (no es un branding removible sin romper la licencia de OSM; con Google pasa lo mismo con su marca).
- Ya existe un secret `GOOGLE_MAPS_API_KEY` en el proyecto (usado por la edge `routing-directions` para *direcciones/rutas*, no para pintar el mapa). Es decir: hoy Google se usa para cálculo de rutas, OSM para el render del mapa.

## Opciones

### A) Seguir con Leaflet + OSM (actual)
- **Costo:** $0. Sin API key ni tarjeta de crédito. Sin riesgo de key expuesta (lección AG1).
- **Calidad en RD:** OSM tiene buena cobertura de calles en zonas urbanas de Santo Domingo/Santiago; menos detalle de comercios/POIs que Google; imágenes satelitales no vienen por defecto.
- **Uso de la política de tiles de OSM:** el tile server público pide un uso "razonable" (no producción de alto volumen). Con el uso actual (unos pocos usuarios de flota) está bien, pero **no es garantía contractual**.

### B) Leaflet + tiles comerciales (recomendado como punto medio)
- Mantener **todo el código Leaflet** (cero reescritura) y solo cambiar la URL de tiles a un proveedor con SLA y crédito gratis generoso:
  - **MapTiler**: 100k cargas/mes gratis, tiles vector/satélite, buena calidad en RD.
  - **Stadia Maps**: ~200k/mes gratis (requiere dominio).
  - **Mapbox** (vía plugin): 50k cargas/mes gratis.
- **Costo:** $0 dentro del free tier (nuestro volumen está muy por debajo).
- **API key:** sí, pero **restringible por dominio/HTTP referrer** — se pone en el front pero acotada, y las de tiles no dan acceso a datos.
- **Ventaja:** SLA real, mejor estética, satélite disponible, y **sin migrar de librería**.

### C) Migrar a Google Maps JS API
- **Costo:** modelo de crédito mensual de **US$200 gratis**, luego **US$7 por 1.000 cargas de mapa** (Dynamic Maps). Con el uso esperado (Seguimiento web + app, decenas de cargas/día) estaríamos **holgadamente dentro del crédito gratis**; el riesgo es un pico de uso o dejar la pestaña recargando.
- **Calidad en RD:** la mejor (POIs, tráfico, satélite, Street View).
- **API key:** **obligatoria y sensible** — hay que restringirla por referrer (web) y por package name + SHA-1 (app). Justo la clase de secreto del incidente **AG1**; exige disciplina de restricción y rotación.
- **Costo de reescritura:** **alto** — Google Maps JS ≠ Leaflet. Hay que reescribir `seguimiento.ts` (init, markers, divIcon → AdvancedMarker, realtime, fitBounds) y la capa de la app. La leyenda AG11 se conserva (es HTML propio).

## Estimación de costo con nuestro uso
- Seguimiento lo abren ~2–5 usuarios (jefe de flota/admin) varias veces al día + la app. Estimado conservador: **< 3.000 cargas de mapa/mes**.
- Con Google: **$0** (muy por debajo del crédito de $200 ≈ ~28.500 cargas). Con MapTiler/Stadia: **$0** (bajo el free tier).
- **El costo NO es el factor decisivo** a este volumen; el factor es **esfuerzo de migración + superficie de seguridad de la key**.

## Recomendación
**Opción B (Leaflet + tiles comerciales, p. ej. MapTiler).** Razones:
1. **Cero reescritura** — se cambia una URL de tiles; todo el código de markers/realtime/leyenda sigue igual en web y app.
2. **Mejor estética y satélite** que OSM, con SLA real.
3. **$0** al volumen actual.
4. **Menor superficie de riesgo** que Google: la key de tiles es restringible por dominio y no da acceso a datos (contraste con la lección AG1).

Google Maps (Opción C) solo se justifica si Xaviel quiere específicamente **Street View / tráfico en vivo / POIs de Google** dentro del mapa; en ese caso conviene hacerlo **primero en web** (una sola superficie), con la key **restringida por referrer desde el día 1**, y medir cargas el primer mes.

## Si se elige Google (checklist de seguridad — lección AG1)
- [ ] Crear key **nueva** en Google Cloud Console (no reutilizar la de `routing-directions`).
- [ ] Restringir por **HTTP referrer** = `sgcconstructorasd.com/*` (y `localhost` solo en dev).
- [ ] Restringir por **API** = solo "Maps JavaScript API".
- [ ] Para la app: key aparte restringida por **package name + SHA-1** del certificado.
- [ ] Presupuesto + alerta de facturación en GCP (aviso al 50 % del crédito).
- [ ] Nunca commitear la key; inyectarla por variable de entorno de build.

## Próximo paso
Xaviel decide entre **A (dejar como está)**, **B (tiles comerciales — recomendado)** o **C (Google)**. Con su OK se hace en un prompt aparte (la migración de tiles B es ~30 min; la C es mayor).
