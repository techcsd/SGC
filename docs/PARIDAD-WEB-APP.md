# Paridad Web ↔ App (AT6)

Regla madre: **la web es el padre de la app** — todo lo que la app puede
capturar/crear/ver debe existir también en la web. Tabla de chequeo (ronda AT,
20/08/2026). Marca ✅ presente · ⚠️ parcial · ❌ falta.

| Módulo / feature | Web | App | Nota |
|---|---|---|---|
| **Ingeniería** (hub) | ✅ *(AT6, esta ronda)* | ✅ | Web: "Solicitud de movimiento" bajo módulo `ingenieria` (antes suelta) |
| Solicitud de movimiento | ✅ | ✅ | Backend compartido (AY11/PROMPT-29). App: outbox offline; web: RPC directo |
| Incentivos (gestión) | ✅ *(AT1-3, esta ronda)* | ⚠️ | App: falta la vista de gestión (deciden desde web/email). Selector de ayudante en flujos = PROMPT-4 |
| Mi rendimiento (chofer) | ✅ *(AT2, esta ronda)* | ⚠️ | App debe mostrarle su puntaje/histórico (PROMPT-4) |
| Requisiciones (bandeja) | ✅ (AS7) | ✅ | — |
| Conduces / entrega / confirmación | ✅ | ✅ | AT8 web: confirmador ya no firma por el chofer |
| Artículos (catálogo + edición + foto) | ✅ | ⚠️ | App: AS20 pendiente (PROMPT-2) |
| Material no catalogado (declinar) | ✅ *(AT11)* | ⚠️ | App consume la bandeja; declinar es web/admin |
| Flota (vehículos, rutas, combustible, checklists) | ✅ | ✅ | — |
| Bitácora | ✅ | ✅ | AT15: pestaña "Todas" gated por permiso |
| Personal de obra (AR1) + import Excel | ✅ *(AT5 import)* | ⚠️ | App: captura en obra (fotos/carnet). Web: import masivo |
| Tecnología / Sistema | ✅ | ⚠️ | AL2 documentó deltas; consola "Sistema" es web |
| Administración (usuarios/roles/permisos) | ✅ | ❌ | Solo web (correcto — es config) |

## Deltas cerrados esta ronda
- **Ingeniería** en la web (menú + módulo `ingenieria` registrado en `MODULOS_DISPONIBLES`;
  el módulo ya estaba concedido a los roles en la BD compartida).
- "Solicitud de movimiento" pasó de item suelto sin icono → hijo del módulo Ingeniería con icono.

## Deltas que quedan (app-side, PROMPT-4/PROMPT-2)
- Incentivo: "Mi rendimiento" en la app + selector de ayudante en rutas/conduces/echadas.
- Artículos en la app (AS20).
- Receptor del conduce (AT16): selector al crear conduce (backend listo).

## Recomendación permanente
Este chequeo se repite cada ronda (AL2 lo hizo para Tecnología/Administración). Mantener
esta tabla como checklist vivo evita el re-reporte de "esto está en la app y no en la web".
