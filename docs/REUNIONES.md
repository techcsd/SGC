# Reuniones + Fireflies (CP8) — lo confirmado antes de construir

> Regla del prompt: *"Antes de construir lo de Fireflies: lee la documentación actual de la API de Fireflies (GraphQL, webhooks, `addToLiveMeeting`, qué incluye el plan Pro) y escribe qué confirmaste y qué no aplica."* Esto es ese documento. Fuente: docs oficiales de Fireflies (`docs.fireflies.ai`) consultadas el 16-oct-2026.

## Confirmado

1. **API GraphQL** en `https://api.fireflies.ai/graphql`, autenticación `Authorization: Bearer <API_KEY>`. La API key se saca en Fireflies › Settings › Developer Settings, por **cuenta** (no por empresa) — la cuenta que la genere será `minutas@constructorasd.com` una vez tenga su asiento.
2. **`addToLiveMeeting(meeting_link: String!)`** — mutación real, existe. Le pide a Fireflies que entre a una reunión que YA está en curso, dado el link (Meet/Zoom/Teams). Lanza `UnsupportedPlatform` si la plataforma no es una de las soportadas. **Sirve como respaldo** tal como lo pedía el default: un cron de 1 minuto que, a la hora de inicio de una reunión con link de Meet, llama esta mutación si Fireflies no entró solo.
3. **Auto-join por calendario** es una configuración **por cuenta/asiento de Fireflies**, no "por empresa": cada cuenta conecta SU calendario (Google/Outlook) y elige una política ("entra a todas las reuniones con link de videollamada", "entra a las que yo organizo", "entra a las de mis compañeros de equipo", "solo si la invito a mano"). **Esto confirma el diseño del default**: creando `minutas@constructorasd.com` como cuenta de Workspace, conectando SU calendario a Fireflies, y configurando su auto-join en "entra a todas las reuniones donde me inviten con link de videollamada" — Fireflies entra a **toda reunión que la invite**, sin depender del calendario personal de nadie. No hace falta ningún plan superior a Pro para esto: es una configuración de UNA cuenta.
4. **Webhooks V2** — configurables en Fireflies › Settings › Developer Settings › Webhooks V2, con eventos granulares (p. ej. "Transcription completed"). Se verifican con un **secreto firmado**: la cabecera `x-hub-signature` trae `sha256=<hmac-hex>` calculado sobre el cuerpo crudo con el secreto configurado al crear el webhook (16-32 caracteres, se genera o se pone a mano en el dashboard). **Si no se configura secreto, Fireflies no manda la cabecera** — por eso el edge `fireflies-webhook` RECHAZA cualquier request sin firma válida (fail-closed), nunca procesa "a ciegas".
5. **Payload del webhook**: `meetingId` (id de la transcripción en Fireflies), `eventType` (p. ej. `"Transcription completed"`), `clientReferenceId` (un identificador propio que se puede mandar al subir/programar — útil para después, no aplica a reuniones que Fireflies graba solo desde el calendario). El contenido real (resumen, puntos, acuerdos, participantes, transcripción) se trae aparte con una consulta GraphQL por `meetingId` tras recibir el webhook.

## Un ajuste real al plan default (confirmado, no aplica tal cual)

**"Los webhooks solo disparan para el DUEÑO/ORGANIZADOR de la reunión en Fireflies."** Esto es importante: si `minutas@` es solo **invitada** a una reunión que organiza otra persona (p. ej. un ingeniero crea el evento de Calendar él mismo e invita a `minutas@`), el webhook configurado en la cuenta de `minutas@` **podría no disparar** para esa transcripción, porque Fireflies ve a esa otra persona como dueña de la reunión, no a `minutas@`. Un webhook "de equipo" que capture TODO sin importar quién organizó requiere el nivel **Enterprise con rol Super Admin** — no está en el Pro que se va a contratar.

**Ajuste al default (Regla A — decisión tomada aquí, no era ambigua la respuesta técnica):**
- **Toda reunión programada DESDE el SGC crea el evento de Calendar con `minutas@constructorasd.com` como ORGANIZADORA** (no como invitada) — así Fireflies siempre la ve como dueña de esa reunión y el webhook de su cuenta dispara siempre. Esto resuelve la ambigüedad que dejó CONTEXTO-49 §H.2 ("desde `minutas@` como organizador, **o el usuario, si se prefiere**") — la respuesta correcta, confirmada por esta restricción real de Fireflies, es **siempre `minutas@` como organizadora** para las programadas desde el SGC.
- **Reuniones externas** (alguien de la empresa las programa fuera del SGC, en su propio Calendar, e invita a `minutas@` como invitada): el webhook puede no disparar de forma confiable. **Respaldo añadido** (no estaba en el default original, se agrega por esta investigación): un **cron de 15 minutos** que consulta la API de Fireflies (`transcripts` por rango de fecha) y trae las transcripciones de `minutas@` que NO disparó webhook (comparando contra `reuniones.fireflies_id` ya conocidos) — mismo resultado final (acta borrador, "reunión sin ligar" si no hay match), solo que por *polling* en vez de push cuando el push no es confiable. Se documenta como limitación conocida, no como bug.

## Lo que necesita Xaviel (sin cambios respecto al contexto)
Crear `minutas@constructorasd.com` en Workspace; asiento Fireflies Pro para esa cuenta (equipo de la empresa — invitar a Felipe al mismo equipo); conectar el calendario de `minutas@` en Fireflies con auto-join "todas las reuniones con videollamada donde me inviten"; sacar su API key; crear el webhook V2 (evento "Transcription completed") apuntando a la edge `fireflies-webhook` con un secreto fuerte; en Google Admin, ampliar la delegación de dominio de la cuenta de servicio del SGC con el scope `https://www.googleapis.com/auth/calendar.events` (hoy solo tiene lectura).

## Mientras tanto (sin llaves)
Todo el módulo de Reuniones (agenda, participantes, notas, acuerdos→tareas, acta escrita a mano) funciona sin ninguna de las piezas de arriba. Sin el scope de Calendar: el botón "Crear evento" muestra "Calendar no conectado — copia esta invitación" en vez de crear el evento real. Sin API key/webhook de Fireflies: no hay actas automáticas ni participación automática; se pega el resumen a mano en el acta. Nada de esto bloquea usar el módulo hoy mismo.

## Calendario de Google (lectura) — CS10, 19-oct-2026

**Hallazgo (regla 19 — verificado en vivo, no de memoria):** ni **dev** ni
**prod** tienen hoy configurados los secretos `GOOGLE_SERVICE_ACCOUNT_JSON` ni
`GOOGLE_CALENDAR_DELEGATED_USER` (confirmado leyendo los NOMBRES de secretos
vía Management API — nunca se imprimió ningún valor). Esto **contradice** la
nota de arriba ("hoy solo tiene lectura"): esa nota describe una intención o un
estado anterior que ya no está — hoy **no hay ninguna cuenta de servicio de
Google conectada al SGC, en ningún entorno**, así que `reuniones-calendar`
(escritura) también responde siempre `{conectado:false}` hoy mismo, aunque
nunca se haya reportado como "roto" (el módulo de Reuniones funciona completo
sin Calendar, como dice arriba). **No puedo confirmar qué scopes tiene
autorizados en Google Admin** una cuenta de servicio que no existe como
secreto aquí — eso solo se ve en Google Admin (fuera de mi acceso).

**Para que "Mi calendario de Google" (lectura) y la sincronización de
escritura funcionen, falta, en orden:**
1. Crear (o localizar) la cuenta de servicio de Google Cloud dedicada al SGC,
   con **domain-wide delegation** habilitada.
2. En Google Admin › Seguridad › Controles de API › Delegación de todo el
   dominio: agregar esa cuenta con los scopes `https://www.googleapis.com/auth/calendar.events` (escritura, como minutas@) **y** `https://www.googleapis.com/auth/calendar.readonly` (lectura, como cada persona — domain-wide delegation permite que el `sub` sea cualquier correo del dominio, no hace falta un scope por persona).
3. Descargar el JSON de la cuenta de servicio y ponerlo en los secretos de **dev primero** (`GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_DELEGATED_USER=minutas@constructorasd.com`), probar, y solo entonces en prod (regla 18).

**Edge nueva `reuniones-mi-calendario`** (solo lectura, `supabase/functions/reuniones-mi-calendario/`): token con scope `calendar.readonly` y `sub` = el correo de quien consulta (nunca uno fijo, nunca uno que llegue en el body); ventana hoy −7 a +60 días; eventos privados salen como «Ocupado» sin lugar/organizador/participantes; rechaza tokens OAuth de Claude (mismo guard que CS6, 42501 únicamente). Hoy responde `{conectado:false, motivo:'no_configurado'}` en dev y en prod — probado así (es el estado real); falta la cuenta de servicio de arriba para probar la lectura real.

**"Llevar al SGC"**: crea la reunión con el tipo "Otra" por defecto y liga `google_event_id` (índice único — dos clics no duplican). No se expone el calendario de Google al conector de Claude en esta ronda (decisión pendiente, ver `docs/CLAUDE-CONECTOR.md`).

## El SGC ya avisa si Calendar falla (CT1, 20-oct-2026)

**Hallazgo:** el SGC crea reuniones sin avisar nunca si Google Calendar funcionó o no — `reuniones.service.ts` descartaba la respuesta del edge (`.catch(() => {})`), así que una reunión "creada" en el SGC parecía normal aunque Calendar nunca recibiera nada. Esto hacía casi imposible notar que, como dice arriba, **ni dev ni prod tienen hoy la cuenta de servicio de Google configurada**.

**Arreglado (sin tocar Google Admin, que sigue siendo 100% de Xaviel):**
- `sgc.reuniones` gana 3 columnas (`calendar_sync_estado`, `calendar_sync_error`, `calendar_sync_at`) que la edge `reuniones-calendar` escribe en CADA intento (crear/actualizar/cancelar), incluido el caso "sin secretos" → `calendar_sync_estado='no_conectado'`.
- La ficha de la reunión (y un ícono en la lista) ya muestra el estado real: "Sincronizado ✓ / No conectado / Error: `<motivo>`" + botón "Reintentar" (ahora público — antes solo se llamaba fire-and-forget al crear).
- Nueva RPC `sgc.reunion_cancelar(p_id)` + botón "Cancelar reunión" en la ficha (antes NO existía ninguna forma de cancelar una reunión desde el SGC) — dispara la cancelación del evento de Calendar si está conectado.
- El creador de la reunión YA estaba siempre invitado (se verificó `reunion_crear`: inserta a `auth.uid()` en `reunion_participantes` sin excepción) — no hacía falta ningún cambio ahí.
- Migración: `sql/2026-10-20-ct1-reuniones-calendar-estado.sql` (dev; falta prod hasta el OK de Xaviel).

**Sigue sin poder probarse con Google real** hasta que exista la cuenta de servicio + secretos (ver arriba) — el estado "no conectado" ahora es visible y honesto, en vez de silencioso.
