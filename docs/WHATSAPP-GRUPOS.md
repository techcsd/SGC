# WhatsApp — memoria de grupos (ronda DB, PROMPT DB-2) — runbook

> Esquema: `sql/2026-11-05-db2-whatsapp-grupos.sql`. Edges: `supabase/functions/wa-ingest`
> (DB-S3) y `supabase/functions/wa-extract` (DB-S4). Pantalla: `Tecnología › Compa en
> WhatsApp` — pestañas **Grupos / Hallazgos / Archivo** (extiende la pantalla DC7, ver
> `docs/WHATSAPP-COMPA.md`). Herramientas de Compa/MCP: DB-S5 (`_shared/herramientas.ts`).
>
> **No confundir con el canal 1:1** (`docs/WHATSAPP-COMPA.md`, ronda DC, WhatsApp Business
> Cloud API oficial de Meta): esta ronda añade un **segundo** canal, de **grupos**, con su
> propio transporte (un cliente WhatsApp Web NO oficial en una laptop) y su propio HMAC.
> El canal 1:1 de Meta sigue intacto y esta ronda lo **reusa** para las respuestas privadas
> (`dm`) — ver §1.

## 1. Arquitectura (texto)

```
Grupo de WhatsApp (empresa)
   │  mensajes de los miembros del grupo
   ▼
csd-wa-listener (repo HERMANO, fuera de este repo)
   │  cliente WhatsApp Web NO oficial, corriendo en una laptop de oficina
   │  firma cada POST: HMAC-SHA256(WA_SHARED_SECRET, timestamp + "." + body)
   ▼
POST /functions/v1/wa-ingest   (x-wa-timestamp, x-wa-signature)
   │
   ▼
supabase/functions/wa-ingest  (DB-S3, verify_jwt=false)
   │  8 tipos de mensaje del Contrato: config · grupos · mensajes · media_url ·
   │  dm · consulta_grupo · heartbeat · evento
   │  Guarda en sgc.wa_grupos / sgc.wa_mensajes_grupo / sgc.wa_listener_estado /
   │  sgc.wa_eventos. Responde RÁPIDO (el listener espera para actuar) — el
   │  trabajo pesado de IA NO vive aquí, salvo 'consulta_grupo' (deliberadamente
   │  barato y acotado a un solo grupo).
   │
   │  'dm' → reusa EXACTO el canal 1:1 existente: llama a `assistant` con
   │  x-wa-secret (mismo WHATSAPP_ASSISTANT_SECRET de la ronda DC), comparte
   │  sgc.whatsapp_conversaciones/whatsapp_mensajes — la memoria de Compa es la
   │  MISMA sin importar si el transporte fue Meta Cloud API o el listener.

pg_cron (independiente del flujo de arriba)
   │  */4 min: extracción · */5 min: revisar_latido · 9am: resúmenes del día ·
   │  lunes: resúmenes de la semana — todos llaman la MISMA edge con `tarea`
   ▼
supabase/functions/wa-extract  (DB-S4, verify_jwt=false, auth x-sync-secret)
   │  1. Pre-filtro de bajo-señal (sin IA) → marca procesado=true
   │  2. Transcribe audio pendiente (_shared/stt.ts, mismo proveedor que el resto del repo)
   │  3. Describe imágenes pendientes (Claude, tope WA_VISION_LIMITE_DIARIO/día)
   │  4. Extrae hallazgos (Claude, prompt endurecido contra inyección) → sgc.wa_hallazgo_insertar
   │  5. revisar_latido: dead-man del listener → alerta si no hay señal >10 min
   │  6. resumenes_dia/resumenes_semana → sgc.wa_resumenes
   ▼
Resend (correo, canal primario) + Telegram (opcional, no-op si no está configurado)
```

**Regla dura de separación (la más importante de esta feature):** dentro de un
GRUPO, Compa responde preguntas SOLO con el archivo de ESE grupo (`consulta_grupo`
— llamada aparte a Claude, sin herramientas de SGC, sin ver otros grupos). Cualquier
dato privado de SGC (requisiciones, nómina, inventario…) solo sale por `dm`, a un
número en la whitelist `sgc.whatsapp_autorizados`, bajo los permisos reales de esa
persona. Nunca se mezclan los dos caminos.

## 2. Secrets por entorno

| Secret | Qué es | Nuevo/reusado | Dónde se consume |
|---|---|---|---|
| `WA_SHARED_SECRET` | Firma HMAC del Contrato con `csd-wa-listener` | **Nuevo** (esta ronda) | `wa-ingest` (`verificarFirmaCompartida`, `_shared/whatsapp.ts`) |
| `WHATSAPP_ASSISTANT_SECRET` | Autentica la llamada a `assistant` en modo WhatsApp | Reusado (BJ2/DC) | `wa-ingest` → `handleDm` → `assistant` |
| `ANTHROPIC_API_KEY` | Llamadas a Claude (extracción, visión, resúmenes, `consulta_grupo`) | Reusado (todo el repo) | `wa-ingest` (`consulta_grupo`), `wa-extract` (todo lo demás) |
| `INFRA_SYNC_SECRET` | Autentica al cron contra `wa-extract` (`x-sync-secret`) | Reusado (mismo patrón que `check-domains`) | `wa-extract` |
| `WA_EXTRACT_MODEL` | Modelo de Claude para extracción/visión/resúmenes | Opcional — default `ASSISTANT_MODEL` → `MODELO_WA_DEFECTO` (`claude-haiku-4-5-20251001`) | `wa-extract` |
| `WA_CONSULTA_GRUPO_MODEL` | Modelo de Claude para `consulta_grupo` | Opcional — mismo fallback que arriba | `wa-ingest` |
| `WA_VISION_LIMITE_DIARIO` | Tope de descripciones de imagen por día | Opcional — default `200` | `wa-extract` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` | Canal de alerta EXTRA (opcional) | Opcional — no-op silencioso si falta cualquiera de los dos | `_shared/alertas.ts` (ya existía para el monitoreo de infraestructura, ver `docs/SGC-CSI-MOD-01-monitoreo-infraestructura.md`) |

Aplicar un secret nuevo (dev primero, regla 18):
```
node scripts/aplicar-secret.mjs --env dev WA_SHARED_SECRET
```

**El correo (Resend) es el canal de alerta PRIMARIO** — ya configurado si
`get_resend_api_key()`/`INFRA_ALERT_EMAILS` funcionan para el resto del repo (no
hace falta nada nuevo). Telegram es un extra que no bloquea nada si no está.

## 3. Rotar `WA_SHARED_SECRET`

Este secret vive en **dos** lugares que deben coincidir siempre: este repo (edge
`wa-ingest`) y la configuración propia de `csd-wa-listener` (repo hermano, fuera
de este código). Rotarlo es un cambio de **ambos lados a la vez**:

1. Genera el valor nuevo (ej. `openssl rand -hex 32`).
2. Actualízalo en este repo: `node scripts/aplicar-secret.mjs --env <dev|prod> WA_SHARED_SECRET`.
3. Actualiza el mismo valor en la configuración del listener (ver su propio README/`.env`).
4. Reinicia/reconecta el listener.

Si solo cambias un lado, el listener empieza a recibir `401` de `wa-ingest`
(firma inválida) hasta que ambos coincidan — no hay periodo de gracia con dos
secrets válidos a la vez.

## 4. Activar/ignorar un grupo

Pantalla **Tecnología › Compa en WhatsApp › Grupos**: cada grupo que el listener
reporta aparece con su `modo`:

- **memoria** (default): se guarda el archivo y la IA extrae hallazgos automáticamente.
- **consulta**: además de lo anterior, el grupo puede preguntarle directo a Compa
  (`consulta_grupo`) — responde SOLO con el archivo de ESE grupo, tope
  `wa_config.max_respuestas_grupo_hora` (10 por defecto) para no saturar.
- **ignorar**: no se guarda nada (defensa en profundidad — el listener ya debería
  filtrar, esto es el segundo seguro del lado del servidor).

También se puede vincular el grupo a un proyecto/obra desde la misma pestaña
(`proyecto_id`), para que los hallazgos queden asociados a esa obra.

### 4.1 — Aviso de privacidad del grupo (DL-04, 10-nov-2026)

Cada tarjeta de grupo muestra una insignia de aviso:

- **«Aviso de privacidad publicado»** (con la fecha en el `title`): `wa_grupos.aviso_enviado_en`
  tiene valor. El **listener** (`csd-wa-listener`, repo hermano) publicó en el grupo un
  mensaje avisando que Compa está presente y guarda lo que se escribe, y reportó
  `aviso_enviado: true` a `wa-ingest` (`supabase/functions/wa-ingest/index.ts`).
- **«Aviso de privacidad sin confirmar»**: `aviso_enviado_en` está vacío. SGC **no publica
  el aviso** — no puede, quien escribe en el grupo es el listener — así que esto solo
  significa que SGC no tiene constancia de que se haya publicado.
- **«No aplica (grupo ignorado)»**: el grupo está en modo `ignorar`, no se guarda nada.

**Estado conocido al 10-nov-2026**: los 4 grupos activos aparecen «sin confirmar»
(incluso uno con días de actividad), igual que `participantes: 0` en todos. Dos
causas posibles, ninguna verificable desde este repo: (a) el listener no está
publicando el aviso en grupos (o falla al hacerlo — ver el bug conocido «No LID
for user» al enviar a grupos, HANDOFF ronda DB), o (b) lo publica pero no lo
reporta en `handleGrupos`. **Pendiente de revisión en `csd-wa-listener`** (fuera
de este repo) — importa legalmente, es parte del inventario de
`docs/DATOS-Y-TERCEROS.md` pendiente con Legal (Ley 172-13).

## 5. Leer hallazgos

Pantalla **Tecnología › Compa en WhatsApp › Hallazgos**: inbox de lo que la IA
extrajo (acuerdos, pedidos de material, montos, fechas límite, incidentes,
decisiones…), con acciones **Revisar / Descartar / Editar / Convertir**.

`confianza` (0–1, mostrado como %) es un **indicador de qué tan segura estuvo la
IA al extraer ese hallazgo — nunca un hecho confirmado**. Un hallazgo con
confianza alta sigue siendo texto que alguien escribió en un grupo de WhatsApp,
no un registro verificado del sistema. "Convertir" (a tarea/requisición/nota)
**no crea nada automáticamente** — arma el texto, abre el módulo destino, y la
persona confirma ella misma que ya lo creó (no existe en este repo un mecanismo
de "crear X prellenado desde Y" por query params; ver el comentario en
`whatsapp.ts` sobre esta decisión).

## 6. Canales de alerta

| Código | Qué significa |
|---|---|
| `listener_latido_caido` | El listener (`csd-wa-listener`) no dio señal de vida en >10 min, o reportó `sesion_cerrada`/`posible_baneo` (vigilado por el cron `revisar_latido`, cada 5 min) |
| `listener_recuperado` | El latido volvió después de haber estado caído (informativo, sin alerta nueva) |
| `listener_estado` | El listener reportó `sesion_cerrada` o `posible_baneo` directamente en su heartbeat (alerta inmediata, además de la vigilancia por cron) |
| `presupuesto_ia_agotado` | `wa_config.budget_tokens_dia` se agotó por hoy — extracción/visión/resúmenes pausados hasta el reinicio diario (se alerta una sola vez por día) |
| `wa_ingest_error` | Excepción no controlada procesando un POST del listener |
| `wa_extract_error` | Excepción no controlada en algún paso del cron (leer pendientes, procesar un grupo, revisar latido, resumir) |
| `wa_extract_sin_api_key` | Tarea IA-dependiente pausada porque falta `ANTHROPIC_API_KEY` (sin correo, para no saturar cada 4 min — sí queda en `wa_eventos`) |

**Correo (Resend) es siempre el canal primario** si está configurado (mismo
`get_resend_api_key()`/`INFRA_ALERT_EMAILS` que el resto del repo). **Telegram es
un extra opcional** — si `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALERT_CHAT_ID` no están
seteados, se omite en silencio, nunca bloquea el correo (mismo criterio que
`docs/SGC-CSI-MOD-01-monitoreo-infraestructura.md`, donde Telegram también
"quedó OPCIONAL").

## 7. Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El listener recibe `401` de `wa-ingest` | `WA_SHARED_SECRET` no coincide entre los dos lados, o el reloj de la laptop del listener se desvió más de 5 minutos (ventana de replay) | Verifica que ambos lados tengan el mismo valor (§3); sincroniza la hora de la laptop (NTP) |
| Los mensajes de un grupo no aparecen en el Archivo | El grupo tiene `modo = 'ignorar'` (Tecnología › Grupos) | Cambia el modo a `memoria` o `consulta` |
| No aparecen hallazgos nuevos aunque hay mensajes | `ANTHROPIC_API_KEY` no configurada en ese entorno (revisa `wa_eventos`, código `wa_extract_sin_api_key`), o `wa_config.budget_tokens_dia` agotado (`wa_eventos`, código `presupuesto_ia_agotado`) | Configura la llave, o espera al reinicio diario / sube el presupuesto |
| El listener parece caído pero nadie se enteró | Revisa que el correo (Resend) esté configurado para ese entorno; confirma en `wa_eventos` si existe `listener_latido_caido` reciente | Configura `get_resend_api_key()`/`INFRA_ALERT_EMAILS` si falta |
| Un grupo en modo `consulta` dejó de responder | Tope `wa_config.max_respuestas_grupo_hora` alcanzado (10/hora por defecto) — se calla hasta la próxima hora, a propósito | Sube el tope en `wa_config` si hace falta, o espera |

## 8. Límites conocidos

- **Historial previo a que el número se uniera al grupo es ilegible para el
  listener** — un cliente de WhatsApp Web solo ve mensajes desde que entra al
  grupo, nunca los de antes. Para eso existe **DB-S10 (importar historial
  viejo)**: subir el `.txt` de "Exportar chat" (WhatsApp → grupo → Exportar
  chat → Sin archivos multimedia) desde **Tecnología › Compa en WhatsApp ›
  Archivo**. Alcance actual: la UI (parseo Android/iPhone, estimado grueso de
  tokens, elegir grupo destino) está construida y **persiste de verdad** vía
  `sgc.wa_importar_mensajes(p_grupo_jid, p_mensajes)` — admin-only, idempotente
  por `wa_message_id` (`import:<hash>` por línea). Los mensajes importados
  entran al mismo pipeline de `wa-extract` que cualquier mensaje nuevo (el
  estimado de tokens antes de confirmar es orientativo, no exacto).
- **Este es un canal NO oficial** (cliente WhatsApp Web automatizado, no la
  Cloud API de Meta) — el riesgo de que WhatsApp banee o cierre la sesión del
  número es **inherente**, no un bug que se vaya a "arreglar": por eso existe
  todo el aparato de latido/alertas (§6) — el objetivo es **detectarlo rápido**,
  no eliminarlo. No usar este número para nada que no tolere una interrupción.
- **Confirmaciones 1:1 nunca ejecutan desde WhatsApp.** Igual que el canal
  Cloud API (DC), cualquier `proponer_*` que Compa use en un `dm` llega como un
  **enlace** a `/borrador/:id` (o al formulario real) — la persona confirma con
  su sesión real en SGC/la app. Ningún `proponer_*` ejecuta una acción real
  solo por recibir un mensaje de WhatsApp.
- **Preview de media en el Archivo**: `wa-ingest` expone `GET ?modo=media&wa_message_id=X`
  (sesión real, gate `puede_ver_submodulo`) que emite una URL firmada de 300s del bucket
  `wa-media` — el botón "Ver vista previa" del detalle de un mensaje la usa.
