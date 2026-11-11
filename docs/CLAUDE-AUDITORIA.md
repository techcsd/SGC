# AUDITORÍA DEL USO DE CLAUDE/IA — SGC + CSD App (DM3, ronda DM, 10-nov-2026)

Inventario técnico (parte A, N1c) de todo lo que usa Claude/IA en ambos repos,
con archivo:línea, riesgos y huecos. Parte B (encuesta por persona) y parte C
(datos de la organización) viven en el módulo Claude (`/claude` › Auditoría),
tablas `sgc.claude_encuesta_respuestas` / `sgc.claude_org_info` —
`docs/CLAUDE-MODULO.md`.

## SGC (web)

### Llamadas directas a Anthropic

| Edge | Qué hace | Modelo |
|---|---|---|
| `assistant/index.ts` | Compa — asistente de chat con herramientas (`_shared/herramientas.ts`) | ver `_shared/claude.ts` |
| `bitacora-ia/index.ts` | Redacta/mejora texto de bitácora de obra | — |
| `leer-cotizacion/index.ts` | Visión — extrae renglones de una cotización/factura | — |
| `leer-documento-flota/index.ts` | Visión — extrae datos de documentos de vehículo (seguro/matrícula) | — |
| `leer-documento-personal/index.ts` | Visión — extrae datos de cédula/pasaporte + verificación cara↔documento | — |
| `leer-especificaciones-equipo/index.ts` | Visión — especificaciones de equipo tecnológico | — |
| `leer-formulario/index.ts` | Visión genérica (DF1-B), usada por CSD App también | — |
| `leer-recibo/index.ts` | Visión — recibo de combustible | — |
| `resumir-reporte/index.ts` | Resume un reporte de Soporte para Tecnología | — |
| `wa-extract/index.ts` | Extrae hallazgos de mensajes/grupos de WhatsApp (texto + visión `wa_vision`) | `MODELO_WA_DEFECTO` |
| `wa-ingest/index.ts` | Enruta un mensaje de WhatsApp 1:1 autorizado hacia `assistant` | — |
| `wa-recap/index.ts` | Genera el PDF de recap diario/semanal de un grupo | — |

Modelo por defecto de WhatsApp: `_shared/claude.ts:85` → `claude-haiku-4-5-20251001`.
`assistant`/visión usan `opts.modelo` configurable (no hardcodeado por edge).

### Consentimiento de IA (CI10/CI13 — "nunca solo en el cliente")

Verificado server-side (403 `sin_consentimiento_ia`) en: `assistant`, `bitacora-ia`,
`leer-cotizacion`, `leer-documento-personal`, `leer-especificaciones-equipo`,
`leer-formulario`, `leer-recibo`, `resumir-reporte`, `transcribe-now` (9 edges).

**Hueco encontrado:** `leer-documento-flota/index.ts:67` se autoriza por un
secreto compartido (patrón cron/servidor), **sin** el gate `sin_consentimiento_ia`
de las demás edges de visión. Si este edge se invoca directamente a nombre de
un usuario (no solo desde un cron), falta el mismo chequeo de consentimiento —
revisar quién llama a esta edge y si corresponde agregarlo.

WhatsApp (`wa-ingest`/`wa-extract`/`wa-recap`) usa una whitelist propia
(`sgc.whatsapp_autorizados`) en vez del consentimiento personal de IA — decisión
ya documentada en `docs/DATOS-Y-TERCEROS.md` (rondas DC/DB2), no es un hueco nuevo.

### Costo (`sgc.uso_ia`)

Cada edge de IA registra su llamada en `sgc.uso_ia` (función/costo estimado);
`sgc.agente_costo_hoy`/`agente_bajo_tope` (DF2) dan un tope diario por agente.
No se encontró una pantalla que sume el costo TOTAL del mes de IA en un solo
lugar — hueco menor, útil para una ronda futura si el gasto crece.

### Agentes (DF2/DF3 + DM2)

`sgc.agentes` (6 agentes DF + `pendientes` de esta ronda) — 100% deterministas,
**cero** llamada a Anthropic salvo el "Mejorar con IA" opcional de DM-09 (crear
skill, gastа `uso_ia`, con consentimiento). El Cronista/Vigía/Pendientes no
usan IA generativa, solo SQL + plantillas de texto.

### Módulo Claude (DM1-DM4, esta ronda)

Ver `docs/CLAUDE-MODULO.md`. El conector de lectura de skills (`mis_skills_claude`/
`leer_skill_claude`) está **apagado** (`claude_skills_conector='false'`) — cero
impacto hasta que se encienda.

## CSD App (móvil)

*(inventario leído de `C:\Users\xavie\Desktop\X Dev\dev2\csd-app\src`, 10-nov-2026)*

### Llamadas a Anthropic — vía los MISMOS edges de SGC, nada directo

- `core/services/compa.service.ts:44,77` — Compa (edge `assistant`).
- `core/services/compa.service.ts:110` — transcripción de nota de voz (edge `transcribe-now`).
- `core/services/formulario-ia.service.ts:79` — visión genérica (edge `leer-formulario`).
- `core/services/flota-documentos-ia.service.ts:34` — documentos de vehículo (edge `leer-documento-flota`).

No hay `ANTHROPIC_API_KEY` ni nombre de modelo en el bundle del cliente — todo
pasa por las edges compartidas del SGC. Nada que filtrar desde el móvil.

### Consentimiento

`core/services/ia-consent-gate.service.ts` + `consent.service.ts` +
`shared/components/consentimiento-ia/` — gate de UX ANTES del primer uso, y
reabre si una edge devuelve 403 `sin_consentimiento_ia`. Confirmado: el chequeo
real vive en el servidor (mismas edges de arriba); el cliente es solo UX —
cumple CI13.

### Compa en la app

`pages/compa/compa.ts` (chat completo) + `shared/components/compa-flotante/` +
`core/services/compa-flotante.service.ts` (lanzador flotante, espejo del web) +
`compa-chat.store.ts` (estado/historial).

### WhatsApp

Confirmado ausente — ningún archivo relacionado con `wa_hallazgos`/`wa_grupos`
bajo `src/`. Es 100% web+backend.

### Agentes

`pages/tecnologia/agentes/` + `core/services/agentes.service.ts` — espejo de
LECTURA del panel web (hallazgos/acciones/aprobaciones/informe/costo), con solo
2 acciones de escritura (`decidirAprobacion`, `deshacerAccion`), mismas RPC que
el web. Ninguna lógica de agente propia en el cliente.

### Riesgos/huecos confirmados en la app (relevantes para PROMPT-141, no para esta ronda)

- `tracking.service.ts:199,361-362,559` — timeout de GPS **fijo** por punto de
  llamada (12000/30000/20000ms), confirma que DM-25 (timeout adaptativo) es
  trabajo real pendiente, no solo una reclasificación.
- `tracking.service.ts:590,614` — el rechazo de lote de `registrar_posiciones`
  se reporta pero no se clasifica la causa en el cliente — confirma DM-26.
- `notificaciones.service.ts:314-346` — **bug confirmado**, igual a DM-28:
  `detenerRealtime()` (343-346) llama `removeChannel` sin `await`, e
  `iniciarRealtime()` (314) nunca revisa `getChannels()` antes de re-suscribir.
  El guard `conectando` solo cubre la carrera en el mismo tick, no
  detener→iniciar en sucesión (reanudar + cerrar/abrir sesión).
- `error-report.service.ts:74-146` — el auto-arreglo de chunk perdido (DB14) ya
  existe y coincide con lo descrito en el contexto de esta ronda; sin hueco
  nuevo encontrado aquí.

*(No se auditó `android/`/`ios-templates/` nativo ni `scripts/` — alcance: UI/
servicios de la app, igual que el resto de esta auditoría.)*

## Resumen de huecos a cerrar (ninguno bloquea esta ronda)

1. `leer-documento-flota` sin gate de consentimiento personal explícito (SGC).
2. Sin vista consolidada de costo mensual total de IA (SGC).
3. GPS/tracking/realtime de csd-app: trabajo real pendiente en PROMPT-141
   (DM-25/26/28), confirmado por esta auditoría, no solo por el triaje de errores.
