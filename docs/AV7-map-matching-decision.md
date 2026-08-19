# AV7 — Map-matching (snap-to-roads): decisión de proveedor

> Registro de decisión que faltaba (el PROMPT-23 pedía research ⏸ ANTES de implementar; el código
> se implementó directo con Google Roads API sin dejar la decisión escrita). Este documento cierra
> ese hueco de proceso — describe lo que se eligió, por qué, el costo y la mitigación.

## Problema
El polyline crudo del tracking (puntos GPS) no sigue las calles: zig-zaguea, corta esquinas y
"salta" entre carriles. Para que el Recorrido diario y el Seguimiento se vean como Google Maps hay
que hacer **map-matching**: proyectar la secuencia de puntos sobre la red vial real.

## Opciones evaluadas

| Proveedor | Modelo | Costo aprox. | Operación | Calidad RD |
|---|---|---|---|---|
| **Google Roads API** (`snapToRoads`) | SaaS, pago por uso | ~US$10 / 1.000 requests (cada request ≤100 pts) | Cero infra; una API key restringida | Alta (mismo dataset que Google Maps, buena cobertura en RD) |
| OSRM (`/match`) self-host | Open source, self-host | Costo de servidor (VPS) + mantenimiento | Hay que hostear + actualizar extractos OSM de RD | Buena, depende del extracto OSM |
| Valhalla (`trace_route`) self-host | Open source, self-host | Costo de servidor + mantenimiento | Más pesado de operar; muy configurable | Buena |

## Decisión: **Google Roads API**
Razones:
1. **Cero infraestructura nueva** — el proyecto ya usa Google Maps (Places, Directions, geocoding) con
   una key servidor restringida en edge functions. Añadir Roads API es marcar una casilla en el mismo
   proyecto de Google Cloud, no levantar y mantener un servidor OSRM/Valhalla.
2. **Consistencia** — la línea "snapped" coincide con el mapa base que ya se pinta (mismo dataset).
3. **Volumen bajo** — el tracking de la flota actual genera pocos requests; con el caché (abajo) el
   costo mensual estimado es marginal. Si el volumen crece, se reevalúa OSRM self-host.

Compensación aceptada: dependemos de un SaaS de pago. Se mitiga con caché agresivo y degradación
elegante (abajo), de modo que un fallo o un tope de cuota **nunca rompe** la vista.

## Implementación (ya en el repo)
- **Edge function `supabase/functions/snap-to-roads`**: llama `roads.googleapis.com/v1/snapToRoads?interpolate=true`,
  parte la traza en trozos de ≤100 puntos con solape para no perder continuidad, key vía `Deno.env`
  (`GOOGLE_MAPS_API_KEY`, nunca en el cliente).
- **Caché server-side `sgc.snap_cache`**: se cachea por **hash SHA-256 del contenido** de la traza →
  la misma jornada no se vuelve a pagar. RLS solo `service_role`.
- **Migración**: `sql/2026-08-20-av7-map-matching-cache.sql`.
- **Wiring web**: `seguimiento.service.ts snapToRoads()` → `seguimiento.ts trazarChofer()` (snapea cada
  segmento antes de dibujarlo).
- **Degradación elegante**: si la API no está habilitada, falla o no hay key, se devuelven los puntos
  crudos y se dibuja el polyline sin snap (la vista funciona igual, solo menos "pegada" a la calle).

## Pendiente (acción de Xaviel en Google Cloud Console)
- [ ] Habilitar **Roads API** en el proyecto de Google Cloud.
- [ ] Confirmar que la key servidor (`GOOGLE_MAPS_API_KEY`, secreto de la edge function) tiene Roads API
      dentro de sus restricciones de API.
- [ ] (Opcional) Poner una cuota diaria de requests como tope de gasto.

Mientras esto no esté hecho, el snap-to-roads degrada a puntos crudos (sin error visible al usuario).
