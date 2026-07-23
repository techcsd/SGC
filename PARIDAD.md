# PARIDAD web ↔ app (X13) — documento vivo

Regla madre: **la web (SGC) es el padre**. No puede haber captura de datos que se
haga en la app móvil (`csd-app`) y en la web no. No se busca clonar la UI de la
app, sino **coherencia funcional y de datos** (mismos campos, validaciones y orden
lógico de captura; el layout puede diferir).

> Estado: iniciado en Ronda 9 (23/07/2026). La auditoría dirigida encontró que
> **el esquema de BD ya soporta casi todo** (ambos RPCs de bitácora escriben una
> fila `bitacora_actividades` por actividad, cada una con su `bloque`). Los gaps
> están en la **capa de formulario/UX de la web** y en la **infraestructura de
> borradores/offline**, no en el esquema.

## Leyenda de clasificación
- **rápido** — cambio pequeño y localizado.
- **mediano** — nueva sección/formulario contra RPC/esquema existentes.
- **requiere decisión** — hay que decidir arquitectura/UX antes de construir.

## Matriz de capacidades (foco: captura de datos)

| # | Capacidad | App | Web | Gap | Clase | Estado |
|---|---|---|---|---|---|---|
| 1a | Múltiples bloques/sujetos en un parte de bitácora | Sí (loop sujeto→actividades) | **Sí (Ronda 9)** — actividades por `(bloque·estructura·actividad)`, repetibles por bloque | — | requiere decisión | **✅ cerrado R9** |
| 1b | `bloque_entrepiso` de cabecera opcional | Opcional (derivado) | **Opcional (Ronda 9)** | — | rápido | **✅ cerrado R9** |
| 1c | Snapshot de clima automático en el parte | No | Sí | — (web adelante) | — | n/a |
| 1d | Set de campos (personal/restricciones/equipos/clima/mín. fotos) | Completo | Completo | No | — | ok |
| 2a | Borradores multi-instancia persistentes | IndexedDB (Dexie) + fotos | **localStorage multi-borrador (Ronda 9, bitácora)** | Parcial | requiere decisión | **🟡 parcial R9** |
| 2b | Autosave en `visibilitychange`/`pagehide` | Sí | valueChanges + `pagehide` (bitácora) | Parcial | mediano | 🟡 parcial R9 |
| 2c | Hub "Documentación en proceso" (borradores + outbox) | Sí | Sección "En proceso" en bitácora | Parcial | mediano | 🟡 parcial R9 |
| 2d | Retomar-incompleto en forms no-bitácora | 14 forms | No | Sí | mediano | backlog |
| 3a | Captura de checklist pre-uso | Sí (offline) | Solo visor/registro (Ronda 6 paridad) | Parcial | mediano | backlog |
| 3b | Captura de combustible | Sí | Dashboards + registro web | Parcial | mediano | backlog |
| 3c | Entrega/recepción de vehículo | Sí | **Sí (W3/Ronda 8 `registrar-entrega`)** | — | — | ok |
| 3d | Captura de multa | Sí | **Sí (T12 + detalle W5)** | — | — | ok |
| 3e | Accidente/daño de vehículo | Sí | **Sí + fotos del hecho (X3/Ronda 9)** | — | — | ok |
| 3f | Reporte de mantenimiento | Sí | **Sí (con tipos X6/Ronda 9)** | — | — | ok |
| 3g | Conteo de inventario con stock en vivo | Sí (diff, offline) | **Solo lista, sin form de conteo** | Sí | mediano | backlog |
| 3h | Entrada/salida de inventario multi-línea | Sí (offline, drafted) | Vistas admin + registro | Parcial | mediano | backlog |
| 3i | Captura offline-first (outbox) | Sí, todos los flujos | No (RPC online) | Sí | requiere decisión | backlog (fuera de alcance web) |

## Decisiones de arquitectura (Ronda 9)

- **Multi-bloque bitácora (1a):** se re-modeló la captura de actividades de la web
  de un mapa `estructura|actividad` a un **arreglo de renglones** con clave
  `(bloque · estructura · actividad)` — la misma actividad puede registrarse en dos
  bloques en el mismo parte. `bloque_entrepiso` de cabecera pasó a **opcional** y
  actúa solo como default. El RPC (`crear_entrada_bitacora`) y el esquema **no
  cambiaron** (ya guardaban `bloque` por actividad).
- **Borradores web (2):** en vez de replicar el IndexedDB+Dexie de la app (pesado
  para el back-office), la web usa **localStorage multi-borrador** (clave por
  instancia) con autosave (`valueChanges` + `pagehide`) y una lista "En proceso"
  para retomar/descartar. No persiste archivos (limitación aceptada: el back-office
  suele completar el parte en una sesión). El hub global de en-proceso y el
  retomar en otros forms quedan en backlog.

## Backlog (priorizar en próximas rondas)
- 2d — retomar-incompleto en forms largos no-bitácora (flota, inventario).
- 3a/3b/3g/3h — formularios de captura web para pre-uso, combustible y **conteo de
  inventario con stock en vivo** (hoy la web solo lista los conteos).
- 3i — captura offline-first en la web (requiere decisión; el back-office suele
  tener conexión, así que baja prioridad).
