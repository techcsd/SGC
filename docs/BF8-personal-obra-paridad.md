# BF8 — Personal de obra: paridad web ↔ app (fila AT6(c) cerrada)

**Hallazgo:** la web NO carecía de Personal de obra. Lo tiene y es un **superset** de la
app. La brecha era de **visibilidad para RRHH**, no de código.

## Inventario (app vs web vs backend compartido)

| Pieza | App (csd-app) | Web (SGC) | Backend compartido (`sgc`) |
|---|---|---|---|
| Wizard registro | ✅ Datos→Documento→Fotos→(Firma ⏸)→Carnet→Resumen (offline outbox) | ✅ Datos→Fotos→Firma→Carnet→Resumen (online) | `personal_obra` + `emitir_carnet_personal` |
| Listado | ✅ | ✅ | RLS por obra |
| Expediente | ✅ | ✅ (más rico) | `personal_obra_fotos` / `_firmas` |
| Carnet + QR + número | ✅ | ✅ | `emitir_carnet_personal`, `personal_carnet_seq` |
| 5 fotos evidencia | ✅ (cámara) | ✅ (upload) | `personal_obra_fotos` |
| Firma | ⏸ pausada | ✅ activa + merge de plantilla + snapshot AZ1 | `personal_obra_firmas` (+ `valores`/`documento_html`) |
| Cuadrilla + Aseguramiento (AV4) | captura | captura + edición en expediente | columnas AV4 |
| Contratos / plantillas Legal (AZ1) | ❌ | ✅ | snapshot AZ1 |
| Import Excel (AT5) | ❌ | ✅ | `importar_personal_obra`, `deshacer_lote_personal` |
| Ciclo de listados (AV4) | ❌ | ✅ | `personal_obra_listados` + RPCs |
| Acceso capataz PIN (AX2) | consume login | ✅ genera | `usuario_id` + edge `acceso-cedula` |
| Conteos por obra | ✅ | ✅ | `personal_obra_conteos` |

**Neto:** la web ya cubre todo lo de la app **más** import Excel, ciclo de listados,
merge de contratos y acceso capataz. Nada que reconstruir.

## Lo que faltaba: visibilidad para RRHH
- **Un solo hogar** (decisión AU1): Personal de obra vive bajo Proyectos
  (`/proyectos/personal`), gateado por el submódulo `proyectos.personal`.
- RRHH tenía el módulo `rrhh` pero no ese submódulo → no lo veía. Admin y roles de
  Proyectos sí lo veían.
- **Fix (BF8):** `sql/2026-09-01-bf8-rrhh-ve-personal-obra.sql` concede
  `proyectos.personal` (operar) a todo rol con módulo `rrhh`. El grupo Proyectos del
  sidebar aparece con cualquier submódulo suyo, así que RRHH pasa a ver
  **Proyectos › Personal de obra** y entra por el guard. No se duplica la pantalla.

## Smoke (RRHH / admin, en la web)
1. Login con rol RRHH → sidebar muestra **Proyectos › Personal de obra**.
2. Registrar personal (wizard completo, con firma + plantilla).
3. Listado → abrir expediente → ver documentos/contratos firmados (AZ1) → imprimir carnet.
4. Import Excel (AT5) desde el mismo hogar.
