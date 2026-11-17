# Avance W3 — UI/cliente y RPC aditivos (16-nov-2026)

Solo dev (ledger dev). Nada en prod, nada en el Odoo real (solo lectura de staging para los nombres). `npm run build` y `npm test` (374) verdes; `deno test` de `parte-voz` 4/4.

## DS-28 — PDF firmado del conduce guardado en el servidor (hecho)
- Sin dependencias nuevas: `src/shared/utils/pdf-simple.util.ts` (PDF mínimo: Helvetica + JPEG, paginación) con spec.
- `src/shared/services/conduce-pdf.service.ts`: arma el documento (cabecera, renglones, firmas emisor/receptor como JPEG sobre fondo blanco), lo sube a `conduces` en `salida/<id>/conduce-<uuid>.pdf` (sin upsert: el guard `audit-buckets` no se activa; el bucket ya tiene políticas insert/select/update y no restringe mime) y llama `salida_pdf_firmado_registrar`.
- Se dispara al cerrar el conduce (`confirmarCierre`) y, para conduces ya cerrados sin PDF, al pulsar Imprimir. Best-effort: un fallo nunca bloquea el cierre. Modelo: `pdf_firmado_path`.
- No probado en navegador con sesión real (sin sesión disponible); la generación del PDF y los bloques están probados en vitest.
- CI13: el PDF (firmas, fotos) ya se guardaba como evidencia; ahora existe también como archivo único. Sin tercero nuevo.

## Cuenta analítica por nombre y selector ampliado (hecho)
- `sql/2026-11-16-w3a-cuenta-analitica-nombre.sql` (+ reversa): columna `proyecto_odoo_analiticas.odoo_analytic_nombre`, RPC `proyecto_cuentas_analiticas_para_oc` ahora devuelve `nombre`, RPC admin/Tecnología `odoo_analitica_nombre_registrar`.
- Data-fix `scripts/data-fixes/2026-11-16-w3-cuenta-analitica-nombres-dev.mjs` (dry-run por defecto, solo lectura de Odoo, resuelve por id ya vinculado): 14/14 nombres rellenados en dev.
- UI: selector también en `compras/ordenes-odoo` (se guarda ANTES de publicar a Odoo) y al aprobar una solicitud de compra en ambas pantallas (`atenderSolicitud` ahora carga las cuentas de la obra). Se muestra el nombre (fallback `#id`) en los selectores y en la tabla de homologación.

## 4 vistas sin filtro es_prueba (hecho, decisión tomada)
- `sql/2026-11-16-w3b-vistas-excluyen-es-prueba.sql` (+ `sql/_reversa/...reversa.sql`): helper `sgc.es_contexto_demo()` (rol `revisor_tiendas` o preferencia `tutorial_demo`, sin depender de `es_usuario_demo`, que es solo-dev). Cada vista muestra solo filas reales (`es_prueba = false`) y el modo demo solo las de prueba. En `v_vehiculo_stats` también se filtran los agregados de combustible, checklists y mantenimientos.
- Prueba de permisos (`scripts/data-fixes/2026-11-16-w3-vistas-es-prueba-permisos.mjs`, solo lectura), filas movimientos/avance/readiness/vehículos:
  - Antes: TODOS los roles (admin, jefe_flota, logística, rrhh, gerente_proyectos, revisor) veían 56/18/20/26, pruebas incluidas.
  - Después: roles normales y admin 20/12/13/18 (solo reales); revisor_tiendas 36/6/7/8 (solo demo). 20+36 = 56, nada se pierde.
- Hallazgo: en dev estas vistas NO tienen `security_invoker` (Y1 lo dio por aplicado). No lo toqué (cambia qué ve cada rol); hay que verificar prod por objeto antes de cualquier migración a prod.
- Cambio visible: un admin ya no ve filas de prueba en esas 4 vistas (para verlas hay que estar en modo demo).

## DS-41 #76 — parte diario por voz/WhatsApp (conexión mínima, apagada)
Lo que ya había: STT (`_shared/stt.ts`, usado por `wa-ingest` para notas de voz en DM), Compa por WhatsApp con borradores `/borrador/:id`, `proponer_bitacora` (solo abre la bitácora con comentarios) y el "Modo rápido" web (`bitacora-ia`: voz/fotos -> propuesta con confianza por campo -> revisión). Faltaba unir voz de WhatsApp con esa propuesta estructurada.
- Parámetro `parte_voz_whatsapp_activo` = `false` (`sql/2026-11-16-w3c-parametro-parte-voz-whatsapp.sql`). Apagado, la herramienta ni se ofrece.
- Herramienta Compa `preparar_parte_diario` (solo canal Compa; módulo bitácora): llama `bitacora-ia` con la sesión del usuario (consentimiento de IA, límites y RLS los impone esa edge), guarda una PROPUESTA y devuelve el enlace `/bitacora/nueva?propuesta=<id>`. Nunca crea la bitácora.
- Web: `bitacora/nueva` abre la revisión con `?propuesta=` (`cargarPropuestaIA`, `propuestaDesdeFila`); misma confirmación de siempre (AT11: lo enviado se ve).
- Tests: `_shared/parte-voz.test.ts` (4), 2 de `propuestaDesdeFila`. Edge `assistant` desplegada solo a dev (v70). No probado de punta a punta por WhatsApp real (requiere número autorizado + consentimiento IA).
- Sigue pendiente la entrevista de producto del propio issue (¿formulario largo o falta de señal?); si es señal, la prioridad es modo offline.

## Pendientes / coordinador
- Y1 notas de versión, `DATOS-Y-TERCEROS.md` (el PDF y el flujo de voz no añaden terceros: Anthropic/STT ya listados), `graphify update .`.
- Prod: nada aplicado; migraciones w3a/w3b/w3c y `assistant` solo en dev.
- `deno check assistant/index.ts` conserva 1 error previo (`ultimoFallo?.motivo`), ajeno a este cambio.
