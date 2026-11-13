# DATOS Y TERCEROS — inventario vivo (CI13)

> **Fuente única** del tratamiento de datos de la **CSD App** y la **web SGC**. La usan:
> la Política de Privacidad (`src/assets/politicas/privacidad.md`), la hoja de consentimiento de IA (CI10),
> los formularios de "Seguridad de datos" (Google Play) y "Privacidad de la app" (App Store), y `docs/TIENDAS-DATOS.md` (hijo).
>
> **Regla (CLAUDE.md, ambos repos):** toda función que recoja un **dato nuevo** o use un **tercero nuevo**
> actualiza este documento **y avisa que la política y los formularios de tienda deben revisarse**.
>
> Última revisión: **05-nov-2026** (ronda DB — WhatsApp: memoria de grupos, segundo canal de
> WhatsApp además del 1:1 de la ronda DC; ver §1/§2/§3 abajo y **🔴 flag al final de este
> documento**). Revisión anterior: **30-oct-2026** (ronda DC — WhatsApp Cloud API; decisión de
> autorización documentada en §1). Primera revisión: **07-oct-2026** (CI13). Verificado contra
> el código (edges en `supabase/functions/*`, servicios en `src/` y en `../dev2/csd-app/src/`).
> Responsable del documento: Tecnología (tecnologia@constructorasd.com).

## 0. Dónde viven los datos (regiones y responsables)

| Pieza | Proveedor | Región real (verificada) | Qué guarda |
|---|---|---|---|
| Base de datos + Storage + Auth (**prod** `csd-core` / `jeeqhgccqefbqilntcpu`) | Supabase (AWS) | **us-east-1 — EE. UU. (Norte de Virginia)** | Todo el dato de negocio y los archivos |
| Base de datos de **pruebas** (`sgc-dev` / `fzfrnrvndzrjwyvdpkgg`) | Supabase (AWS) | **us-east-1 — EE. UU.** | Datos sembrados de prueba (no reales) |
| Hosting de la web SGC | Vercel | **EE. UU. (despliegues `iad1`, CDN global)** | Sitio estático; sin dato personal en reposo (solo logs de petición del CDN) |

**Transferencia internacional:** la empresa opera en **República Dominicana**; los datos se procesan en servidores en **EE. UU.** (Supabase/AWS, Vercel) y, cuando aplica, en los proveedores de la tabla §2. Esto se declara en la política (Ley 172-13, transferencias a proveedores fuera del país).

## 1. Datos que se recogen → dónde viven → para qué

| Dato | Dónde se guarda (tabla / bucket) | Finalidad | ¿Vinculado al usuario? |
|---|---|---|---|
| Nombre, correo, teléfono, **cédula**, cargo, rol | `sgc.usuarios`, `sgc.conductores`, `sgc.personal_obra` | Cuenta, identificación y operación | Sí |
| Contraseña / PIN (hash) | Supabase Auth · `sgc.usuarios` (PIN hash) | Inicio de sesión | Sí |
| **Ubicación precisa** (también en 2.º plano, choferes que comparten) | `sgc.chofer_posiciones`, `sgc.chofer_ultima_posicion`, `sgc.recorridos_diarios` | Seguimiento de flota y registro de rutas | Sí |
| Estado del chofer (disponible/en ruta/…/inactivo) | `sgc.chofer_estado`, `sgc.chofer_estado_historial` | Jornada; **controla el encendido del GPS** (CI5) | Sí |
| Fotos (cámara/galería), firmas, PDFs | Buckets `sgc-bitacora`, `sgc-documentos`, `sgc-rrhh`, `sgc-avatars`, `vehiculos`, `conductores`, `mantenimiento_adjuntos`, etc. | Evidencias de obra, inventario, flota, RRHH | Sí |
| **Audio** (notas de voz) | Bucket de audio · `sgc.audio_notas` | Incidentes/notas; se transcribe (ver §2 IA) | Sí |
| Identificadores del dispositivo, **token de push**, plataforma, versión de app | `sgc.device_tokens`, `sgc.platform_reports` | Notificaciones, soporte | Sí |
| Registros de error / diagnóstico | `sgc.reportes_error` (y afines) | Soporte técnico | Sí |
| Biometría (huella/rostro) | **Solo en el teléfono** (`@aparajita/capacitor-biometric-auth`); **nunca sale del dispositivo** | Desbloqueo de la app | No (local) |
| Uso de IA (conteo, para límites) | `sgc.uso_ia` | Control de abuso/costos de las funciones de IA | Sí |
| Consentimiento de IA / ubicación en 2.º plano | `sgc.consentimientos` (CI10) | Prueba de permiso explícito (tiendas) | Sí |
| Aceptación de políticas (versión, fecha) | `sgc.aceptaciones_politicas` (CI3) | Prueba de aceptación de privacidad/términos | Sí |
| Autorización del canal de WhatsApp (ronda DC, decisión) | `sgc.whatsapp_autorizados` (`creado_por`, `creado_en`, `activo`) | **Prueba de autorización — administrativa, no CI10.** Un admin/Tecnología habilita el número de UN empleado puntual (nunca autoservicio); el `aviso_primer_uso_en` de `sgc.whatsapp_conversaciones` sella cuándo esa persona recibió el aviso de privacidad por el canal. Se decidió así (en vez de replicar la hoja CI10) porque WhatsApp es un canal **externo** sin sesión donde mostrar el interruptor de *Perfil › Privacidad* antes de escribir — ver §3 de `privacidad.md`. Revocar es inmediato (`activo=false`) | Sí |
| Solicitudes de eliminación de cuenta | `sgc.solicitudes_eliminacion_cuenta` (CI4) | Derecho de cancelación (Ley 172-13) | Sí |
| **Credenciales, llaves API y tokens, semillas 2FA, notas/archivos de la empresa (Vault, CZ3)** | `sgc.boveda_entradas` (cifradas AES-256-GCM en servidor; columnas en claro **sin SELECT para `authenticated`**), `sgc.boveda_accesos` (auditoría, solo-insertar) | Custodia de credenciales de administrador/desarrollo de la empresa (no son datos personales de empleados) para continuidad del negocio | No es dato de un empleado — son credenciales de **sistemas/servicios** de la empresa, administradas por el rol Administrador |
| **Mensajes de grupos de WhatsApp de la empresa** (ronda DB, 05-nov-2026) — teléfono y nombre del AUTOR de cada mensaje, texto, transcripción de notas de voz, descripción de imágenes | `sgc.wa_mensajes_grupo` (archivo, retención 180 días — ver §3), `sgc.wa_grupos` (metadatos del grupo), bucket privado `wa-media` (la imagen/audio original, mismo plazo que el mensaje) | Memoria de grupos para no perder acuerdos/pedidos/montos mencionados en el chat de obra/logística; base de la extracción de hallazgos (fila siguiente) | Sí — el autor es casi siempre un empleado (chofer, encargado, ingeniero); puede incluir terceros (proveedores) que participan en el grupo sin ser empleados de la empresa |
| **Hallazgos extraídos por IA de esos mensajes** (acuerdos, pedidos de material, montos, fechas límite, decisiones, incidentes) | `sgc.wa_hallazgos` | Que Tecnología/el área correspondiente pueda revisar y convertir en tarea/requisición/nota sin releer el chat completo | Indirectamente (cita nombres/personas mencionadas en `personas` jsonb) — ver nota de conservación distinta en §3 |
| Heartbeat/estado del listener externo de WhatsApp (sin dato personal de terceros, solo salud del proceso) | `sgc.wa_listener_estado`, `sgc.wa_eventos` | Monitoreo operativo (dead-man, presupuesto de IA, errores) | No |
| **Recap diario/semanal con PDF por correo** (ronda DL, 10-nov-2026) — resumen generado por IA + decisiones/acuerdos + lista de pendientes abiertos (con responsable) de un grupo de WhatsApp, adjunto como PDF a un correo | `sgc.wa_resumenes` (resumen/decisiones/pendientes), bucket privado `wa-recaps` (el PDF, retención 180 días), `sgc.wa_recap_envios` (log de a quién se le mandó) | Que los responsables/Tecnología tengan un resumen accionable sin tener que leer todo el chat; el PDF **no** incluye la transcripción cruda, solo lo derivado por IA | Sí — el PDF puede nombrar a empleados y, si participaron, a terceros (proveedores) del grupo, como responsables de un pendiente o autores de una decisión |
| **Recordatorios de pendientes** (ronda DL) — a quién se le recuerda un hallazgo sin cerrar (correo/bandeja/push/WhatsApp privado) | `sgc.wa_recordatorios` (log, 1 fila por intento), `sgc.wa_hallazgos.responsable_id` | Que la persona a quien se le pidió algo en un grupo no se le olvide, sin que Tecnología tenga que perseguirlo a mano | Sí — el responsable es siempre un empleado (usuario SGC); el contenido recordado deriva del mismo dato de grupos ya declarado arriba |

**No se recoge:** datos de publicidad, rastreo entre apps/sitios (sin App Tracking Transparency), ni datos de menores (app de empleados).

**Vault (CZ3) — sin tercero nuevo:** el cifrado es propio (AES-256-GCM en la edge `boveda`, llave `BOVEDA_MASTER_KEY` en los secrets de Supabase, distinta por entorno) — no se envía ningún secreto a un servicio externo; sigue viviendo en la misma base de datos de Supabase ya declarada en §0/§2. No aplica actualización de la Política de Privacidad ni de los formularios de tienda (el Vault no es alcanzable desde la app móvil en esta ronda — ver `PARIDAD.md` CZ7 — y no trata datos personales de empleados, solo credenciales de sistemas).

## 2. Terceros (procesadores) — verificado por `grep` de las edges (`supabase/functions/*`)

| Tercero | Para qué | Qué se le envía | Dónde en el código | País/región |
|---|---|---|---|---|
| **Supabase** (AWS) | Base de datos, archivos, auth, edge functions | Todo el dato de negocio | toda la app | EE. UU. (us-east-1) |
| **Vercel** | Hosting de la web | Peticiones web (sin dato en reposo) | despliegue web | EE. UU. / CDN global |
| **Resend** | **Correo transaccional** (avisos, informes) | Nombre y **correo** del destinatario + contenido del aviso | `api.resend.com` en 11 edges: `notificar-*`, `incentivo-*`, `generar-informe-obra`, `resumen-semanal-operaciones`, `check-domains`, `check-subscriptions` | EE. UU. |
| **Anthropic (Claude)** | **IA** — asistente "Compa", conector MCP, y lectura de recibos/cotizaciones/especificaciones de equipo/documentos de flota/documento de identidad del personal de obra/resúmenes de reportes de soporte (ronda DB) | Lo que el usuario escribe + datos de la empresa necesarios para responder; **foto del recibo/cotización**; **foto de "Información del sistema" de Windows** (dato personal ligero: nombre del equipo, cuenta de Windows con sesión iniciada — DA9, no se guarda la imagen salvo que el usuario la suba como foto "especificaciones"); **ronda DB (29-oct-2026):** fotos/PDF de documentos de VEHÍCULO (seguro/matrícula/marbete — solo campos extraídos, revisión humana por fila), **foto de la cédula/pasaporte del personal de obra + foto de la persona con el documento** (DB5 — la IA solo extrae los campos del alta y un veredicto cara↔documento; NO se guarda ninguna transcripción fuera de los campos del registro; las 2 fotos se guardan como las fotos tipadas de siempre del expediente), y el texto/fotos de reportes de Soporte para el resumen de ronda (DB6, solo admin/Tecnología); **ronda DC (29-oct-2026):** lo mismo, ahora también por el canal de **WhatsApp** (texto o transcripción de nota de voz de un número en la lista blanca `sgc.whatsapp_autorizados`); **ronda DB2 (05-nov-2026), un consumidor MÁS del mismo procesador ya declarado arriba:** texto de mensajes de **grupos** de WhatsApp (extracción de hallazgos, resúmenes diarios/semanales, respuesta `consulta_grupo` restringida al archivo de un solo grupo) + descripción de imágenes de grupo (`wa_vision`, tope diario) — ver `docs/WHATSAPP-GRUPOS.md`; **ronda DO (12-nov-2026):** CV (PDF/foto) de un **candidato** a empleo (RRHH › Reclutamiento) — la IA extrae nombre/teléfono/email/resumen de experiencia/educación/cargos previos y los guarda en `rrhh_candidatos.cv_extraido` para revisión humana; **extracción interna de un solo propósito, dentro del edge function — NO se expone al chat de Compa ni al MCP general** (misma distinción que ya aplica a `leer-documento-flota`); además, dentro del módulo Claude › Skills, el borrador de "Pasos"/"Ejemplo" de "Sugerir con IA" (`claude-skill-sugerir`, DO-10e) solo recibe el texto que el propio usuario escribió ("Qué hace"/"Cuándo usarla"), sus roles, y los **títulos/descripciones** (no personas) de las skills que ESE usuario ya puede ver (vía RLS, cliente scoped al JWT — nunca service role, así que nunca se filtran skills de otros roles/equipos sin acceso) | `api.anthropic.com` en `assistant/index.ts:608`, `leer-recibo/index.ts:125`, `leer-cotizacion/index.ts`, `leer-especificaciones-equipo/index.ts`, `wa-ingest/index.ts` (`consulta_grupo`), `wa-extract/index.ts` (extracción/visión/resúmenes), `rrhh-leer-cv/index.ts`, `claude-skill-sugerir/index.ts` | EE. UU. |
| **Groq** | **IA** — transcripción de voz (principal) | **Audio** de la nota de voz (incluye notas de voz de WhatsApp 1:1, ronda DC, y notas de voz de **grupo**, ronda DB2 — el archivo se descarta tras transcribir, nunca se guarda) | `api.groq.com` en `transcribe-now:38`, `transcribe-audio:25`, `whatsapp-webhook` (vía `_shared/stt.ts`, DC4), `wa-extract/index.ts` (vía `_shared/stt.ts`) | EE. UU. |
| **OpenAI** | **IA** — transcripción de voz (respaldo de Groq) | **Audio** de la nota de voz (incluye WhatsApp 1:1 y de grupo, ver fila de Groq) | `api.openai.com` en `transcribe-now:37`, `transcribe-audio:24`, `whatsapp-webhook` (vía `_shared/stt.ts`, DC4), `wa-extract/index.ts` | EE. UU. |
| **Google — Firebase Cloud Messaging** | Notificaciones push | Token de push + contenido del aviso | `fcm.googleapis.com`, `oauth2.googleapis.com` en `send-push` | EE. UU. / global |
| **Google — Maps Platform** | Geocodificación inversa, lugares, rutas, "snap to roads", resolver enlaces de mapa | Coordenadas / texto de dirección / enlace de mapa | `maps.googleapis.com` (`reverse-geocode`, `routing-directions`), `places.googleapis.com` (`places-search`, `resolve-maps-link`), `roads.googleapis.com` (`snap-to-roads`) | EE. UU. / global |
| **Open-Meteo** | Clima de las obras | **Coordenadas** de la obra (sin dato personal) | `api.open-meteo.com`, `air-quality-api.open-meteo.com` en `sync-weather-obras` | UE (sin dato personal) |
| **OpenStreetMap — Nominatim** | Geocodificación (buscar dirección) | Texto de búsqueda / coordenadas | `nominatim.openstreetmap.org` en `src/shared/context/geocoding.service.ts:13` | UE |
| **Odoo 17** (ERP de la empresa, administrado por Chai Consultoría) | Fuente de verdad de inventario (PoC de **solo lectura**: stock, productos, ubicaciones) | Solo parámetros de consulta (término de búsqueda, IDs de producto/ubicación) y el JWT NO se reenvía; la cuenta técnica es del servidor. Se **reciben** nombres de producto/ubicación/almacén y cantidades (sin dato personal) | `supabase/functions/_shared/odoo-client.ts`, `odoo-api/` (XML-RPC `/xmlrpc/2/*`); secrets `ODOO_*`; caché efímera en memoria del isolate (TTL 15 s–10 min, no persiste) | Por confirmar con Chai Consultoría (hosting del ERP) |
| **RDAP** (`rdap.org`) | Herramienta interna de Tecnología (verificar dominios); **no procesa dato de empleados** | Nombre de dominio | `check-domains/index.ts:166` | — (herramienta interna) |
| **Meta Platforms (WhatsApp Business Cloud API)** — ronda DC, 29-oct-2026 | Canal **1:1** de WhatsApp para Compa (texto y notas de voz) — reemplaza el puente n8n/Evolution, no oficial (ver `docs/WHATSAPP-COMPA.md` §10 y la nota de retiro en `docs/SEGURIDAD.md`) | **Número de teléfono** del empleado que escribe, **contenido del mensaje** (texto o transcripción de la nota de voz — el audio en sí NUNCA se guarda), metadatos de entrega (wa_message_id, estado) | `supabase/functions/whatsapp-webhook/index.ts`, `supabase/functions/_shared/whatsapp.ts`; tablas `sgc.whatsapp_mensajes`/`sgc.whatsapp_conversaciones`/`sgc.whatsapp_autorizados` | EE. UU. / global (infraestructura de Meta) |
| **Cliente WhatsApp Web NO oficial** (`csd-wa-listener`, repo hermano, 05-nov-2026) — **mecanismo de captura** de un número dedicado añadido a los grupos de la empresa, NO un servicio en la nube de terceros | Captura los mensajes de los grupos y los reenvía (firmados por HMAC) a `wa-ingest` — es un programa de automatización de WhatsApp Web (como Baileys/whatsapp-web.js), **no una API oficial de Meta**; corre en una laptop de oficina, no en infraestructura de este repo ni de un proveedor cloud contratado | **Todo lo que pasa por el grupo mientras el número esté en él**: número/nombre del autor de cada mensaje, texto, audio/imagen crudos (solo de paso — el listener los reenvía, no los retiene él mismo más allá de lo operativo) | Repo hermano `csd-wa-listener` (fuera de este código) → POST a `supabase/functions/wa-ingest` | La laptop vive en la oficina de Constructora SD (RD); el dato en reposo queda en Supabase (EE. UU., ver fila Supabase arriba) — **dirección del flujo es de un solo sentido: grupo de WhatsApp → laptop → Supabase, nunca al revés** |

> **Mapas en la web:** hoy la web usa **Google Maps Platform** para las teselas/mapa (migración ya hecha; ya no se usan teselas OSM directas). OpenStreetMap queda solo como geocodificador (Nominatim). En la **app móvil** sí quedan teselas OSM (CI15 — higiene, PROMPT-87).

## 3. Conservación

| Dato | Conservación |
|---|---|
| Cuenta (usuario, cédula, cargo) | Mientras exista la relación laboral/contractual; al eliminar la cuenta se **anonimiza** (CI4), conservando los registros operativos/contables con el usuario como "Usuario eliminado" |
| Ubicación / rutas | Según necesidad operativa de flota (histórico de recorridos); revisable |
| Fotos / firmas / PDFs / audio | Mientras el registro de negocio los necesite (evidencia de obra/inventario/flota/RRHH) |
| Token de push / dispositivo | Mientras el dispositivo esté activo; se borran al eliminar la cuenta o al cerrar sesión |
| Registros contables (conduces, inventario, combustible) | Obligación legal/contable — se conservan aun tras anonimizar al usuario |
| Consentimientos / aceptaciones | Como prueba del permiso, mientras la cuenta exista |
| Mensajes de WhatsApp (`sgc.whatsapp_mensajes`) | **90 días** (cron `sgc-purgar-whatsapp-mensajes`, Ley 172-13) — ronda DC |
| Mensajes de grupos de WhatsApp (`sgc.wa_mensajes_grupo`) + media (`wa-media`) | **180 días** (cron `sgc-wa-purgar-mensajes-grupo`, `sgc.wa_purgar_mensajes_viejos()`) — ronda DB2. El audio NUNCA se conserva más allá de su transcripción (mismo criterio que DC4); la transcripción sí sigue el plazo de 180 días como el resto del mensaje |
| Hallazgos y resúmenes extraídos de grupos (`sgc.wa_hallazgos`, `sgc.wa_resumenes`) | **Sin límite de retención** — a propósito, distinto del archivo crudo de arriba: son productos analíticos derivados (un acuerdo, un monto, un resumen), no el dato personal crudo en sí. Se tratan como registro de negocio (equivalente a una minuta/acta), no como dato personal de conservación acotada. **Esta distinción es una decisión de producto de esta ronda, no una obligación legal verificada — queda explícita en el flag de abajo para que Sonia la confirme** |
| Eventos del puente de grupos (`sgc.wa_eventos`) | **60 días** (cron `sgc-wa-purgar-eventos`) — son logs operativos (heartbeats, errores), no archivo de conversación |

## 3bis. Avisos de WhatsApp — grupos vs. 1:1 (ronda DB2)

- **Aviso dentro del GRUPO** (nuevo, esta ronda): la primera vez que el número
  dedicado entra en modo `memoria`/`consulta` en un grupo, se manda (o se deja
  pendiente de mandar — `wa_grupos.aviso_enviado_en`) el texto configurable
  `wa_config.texto_aviso_grupo`, una sola vez por grupo:
  > "Hola, soy Compa, el asistente con IA de Constructora SD. Estoy en este
  > grupo para llevar memoria de acuerdos y pendientes. Si tienen dudas sobre
  > esto, hablen con Tecnología."
- **Aviso de primer uso en DM (1:1)**: esta ronda **reusa exactamente** el
  mismo aviso/flujo de consentimiento ya documentado para el canal 1:1 de la
  ronda DC (`whatsapp_conversaciones.aviso_primer_uso_en`) — el camino `dm` de
  `wa-ingest` llama al mismo `assistant` en modo WhatsApp, así que no hace
  falta (ni se construyó) un aviso nuevo para ese camino.

## 4. Al tocar el código (recordatorio de la regla)

Si agregas una función que:
- **recoge un dato nuevo** (una columna/tabla/bucket con dato personal nuevo), o
- **llama a un tercero nuevo** (un host externo nuevo en una edge o en el front),

entonces: (1) **actualiza este documento** (fila en §1 o §2), y (2) **avisa en el reporte/HANDOFF** que *la Política de Privacidad y los formularios de Seguridad de datos (Play) / Privacidad de la app (Apple) deben revisarse* antes del próximo envío a tiendas.

## 🔴 Flag pendiente — ronda DB2 (05-nov-2026), memoria de grupos de WhatsApp

Esta ronda agrega un **dato nuevo** (archivo de grupos de WhatsApp — autor, texto,
transcripción, descripción de imagen) y un **mecanismo de captura nuevo** (cliente
WhatsApp Web NO oficial en una laptop de oficina, repo hermano `csd-wa-listener`).
Por la regla de este documento (§4) y la regla CI13 del CLAUDE.md:

- **Xaviel debe confirmar con Sonia (Legal) si esto requiere aviso/consentimiento
  formal bajo la Ley 172-13** — en particular porque algunos de los participantes
  del grupo (proveedores, terceros) pueden no ser empleados de la empresa y no
  pasan por el flujo de aceptación de políticas de la cuenta SGC (CI3).
- **Revisar si la Política de Privacidad** (`src/assets/politicas/privacidad.md`)
  necesita una sección nueva (o una ampliación de la sección de WhatsApp ya
  existente de la ronda DC) que cubra el archivo de grupos.
- **Revisar si los formularios de "Seguridad de datos" (Google Play) / "Privacidad
  de la app" (App Store)** necesitan actualizarse — aunque esta pantalla es
  SOLO web (sin contrato para `csd-app` esta ronda, ver `PARIDAD.md`), el dato
  de los grupos sigue siendo dato personal tratado por la empresa.
- **No se ha hecho ninguna de las tres cosas de arriba todavía** — queda pendiente
  de la confirmación de Xaviel/Sonia, no de una decisión técnica de esta ronda.

## 🔴 Flag pendiente — ronda DL (10-nov-2026), recap por correo con PDF

Esta ronda agrega un **flujo de salida nuevo** sobre el mismo dato ya declarado en
el flag de arriba (mensajes de grupos de WhatsApp): un **PDF generado por IA**
(resumen + decisiones + pendientes, con nombres de responsables) que se manda
**por correo** a quien Tecnología configure como destinatario del recap de cada
grupo. Es el mismo dato personal de siempre, pero con un **canal de salida
nuevo** (adjunto de correo, guardado 180 días en el bucket `wa-recaps`) que no
existía antes de esta ronda.

- Se mantiene la misma pregunta pendiente de arriba para Sonia/Legal — este
  flujo la hace más urgente, porque ahora el dato derivado **sale** de SGC por
  correo (antes solo vivía en la pantalla de Tecnología).
- El PDF **nunca** incluye la transcripción cruda del chat, solo lo que la IA
  resumió (DL-22) — mitiga pero no resuelve la pregunta de fondo.
- Sigue sin hacerse ninguna actualización a la Política de Privacidad ni a los
  formularios de tienda — mismo pendiente que el flag de arriba, ahora con un
  flujo más para cubrir cuando se resuelva.

## DM1 (ronda DM, 10-nov-2026) — módulo Claude: skills subidas + encuesta

**Dato nuevo (dentro de nuestro propio sistema, no un tercero nuevo):** el
módulo Claude (`docs/CLAUDE-MODULO.md`) guarda, en el bucket privado
`claude-skills`, **el contenido que cada persona sube como "skill"** (archivo
`.md`/`.zip`/texto suelto) — puede ser cualquier texto que la persona escriba,
escaneado por secretos antes de guardarse (DM-05) pero no revisado por un
humano salvo que se proponga a rol/empresa (DM-06/07). `sgc.claude_skills` +
`sgc.claude_skill_versiones` guardan metadatos (nombre, descripción, dueño,
hash) — RLS: lo mío + lo publicado para mi rol/empresa.

También nuevo: `sgc.claude_encuesta_respuestas` — respuestas (texto libre) de
la encuesta corta de auditoría N1c, ligadas a `usuario_id` y a un snapshot de
su rol. Visible para la propia persona y para `tecnologia.claude_auditoria`.

**Anthropic sigue siendo el mismo tercero ya declarado arriba** — este módulo
NO envía nada a la API de Anthropic desde el backend; la persona misma sube el
archivo descargado a su cuenta de Claude, un paso manual fuera de SGC. El
conector de **lectura** de skills (DM-14, `mis_skills_claude`/`leer_skill_claude`)
sí sería un flujo nuevo hacia Claude **cuando se encienda** (hoy apagado,
`claude_skills_conector='false'`) — se revisará este documento otra vez en ese
momento, no antes.

- 🔴 Pendiente de revisar: la Política de Privacidad y los formularios de
  "Seguridad de datos"/"Privacidad de la app" no mencionan todavía que el SGC
  guarda archivos que la persona sube voluntariamente como "skill". Bajo
  riesgo (dato que la propia persona decide subir, con escaneo de secretos),
  pero debe anotarse en la próxima revisión de esos documentos.
