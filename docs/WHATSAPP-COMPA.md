# Compa por WhatsApp (Cloud API oficial) — runbook

> Ronda **DC** (29-oct-2026, rebautizada de "DA" por colisión de letra de ronda —
> el prompt original usaba DA1–DA9, pero "DA" ya era la ronda de inventario
> tecnológico, PROMPT-122, en producción desde el 28-oct). Reemplaza el puente
> n8n + Evolution API (no oficial — ver skill `ws-ops`) por el **webhook oficial
> de Meta**. El "cerebro" (resolución de usuario, permisos, RLS, el propio
> Compa) **no cambió** — viene de BJ2 (04-sep-2026). Lo único nuevo es el
> transporte: cómo entra y sale el mensaje de WhatsApp.

## 1. Arquitectura (texto)

```
Meta (WhatsApp Business Platform)
   │  POST /functions/v1/whatsapp-webhook   (firma X-Hub-Signature-256)
   ▼
supabase/functions/whatsapp-webhook  (DC3, verify_jwt=false)
   │  1. Verifica firma HMAC (WHATSAPP_APP_SECRET)
   │  2. Responde 200 YA, procesa en EdgeRuntime.waitUntil(...)
   │  3. Dedupe por wa_message_id (sgc.whatsapp_mensajes, columna única)
   │  4. Resuelve teléfono → usuario (sgc.whatsapp_resolver, BJ2, sin cambios)
   │  5. No autorizado → mensaje educado (máx. 1/24h) · nunca llama a Claude
   │  6. Autorizado → POST x-wa-secret a `assistant` (igual que el viejo puente)
   ▼
supabase/functions/assistant  (modo WhatsApp, BJ2 + DC5)
   │  Abre sesión real (magic link) para el usuario resuelto
   │  Corre el MISMO Compa (tools, RLS, permisos) con pista de canal "WhatsApp"
   │  Memoria de conversación por teléfono (sgc.whatsapp_conversaciones)
   │  'proponer_*' → borrador (claude_borrador_crear) + enlace /borrador/:id
   ▼
whatsapp-webhook — formatea la respuesta (markdown→WhatsApp, chunking) y la
manda por Graph API (POST /{GRAPH_VERSION}/{PHONE_NUMBER_ID}/messages)
```

Tablas nuevas (DC2, `sql/2026-10-29-dc2-whatsapp-cloud-api.sql`):
`sgc.whatsapp_mensajes` (bitácora, retención 90 días), `sgc.whatsapp_conversaciones`
(estado por teléfono). Tabla existente ampliada: `sgc.whatsapp_autorizados`
(+ `actualizado_en`, `ultimo_uso_en`).

Helpers compartidos: `supabase/functions/_shared/whatsapp.ts` (firma, normalización
de teléfono, markdown→WhatsApp, chunking, cliente Graph con backoff — mismo
patrón que `_shared/odoo-backoff.ts`) y `_shared/stt.ts` (llamada al proveedor de
transcripción, compartida con `transcribe-audio`).

## 2. Secrets por entorno

| Secret | Qué es | Dev (esta ronda) | Prod |
|---|---|---|---|
| `WHATSAPP_ASSISTANT_SECRET` | Compartido con `assistant` (BJ2) — autentica el webhook ante Compa | rotado (ver §6) | pendiente — el valor de n8n sigue vigente hasta que se corte el bridge viejo |
| `WHATSAPP_TOKEN` | Token permanente del System User de Meta | placeholder (`PENDIENTE-TOKEN-META-REAL`) | pendiente — lo da Xaviel |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número en Meta (no el número en sí) | placeholder (`000000000000000`) | pendiente |
| `WHATSAPP_APP_SECRET` | App Secret de la app de Meta — firma el webhook | valor de prueba (generado por esta ronda, solo para firmar payloads falsos) | pendiente |
| `WHATSAPP_VERIFY_TOKEN` | String arbitrario que Meta repite en la verificación GET | valor de prueba (generado por esta ronda) | pendiente |
| `WHATSAPP_GRAPH_VERSION` | Versión de Graph API (opcional, default `v26.0` en el código) | no seteado (usa el default) | no seteado |

Aplicar un secret (dev):
```
node scripts/aplicar-secret.mjs --env dev WHATSAPP_TOKEN
```
(el script pide el valor por `.env.local` con la clave `WHATSAPP_TOKEN_DEV`, o lo pregunta en el prompt si no está — nunca lo pases por `--value` en texto plano salvo que sea tú mismo tecleándolo).

**Importante (DC1):** este documento, `docs/ENTORNOS.md` y el código ahora están
alineados en `WHATSAPP_ASSISTANT_SECRET` — antes `docs/ENTORNOS.md` decía
`WHATSAPP_ASSISTANT_SYNC_SECRET`, un nombre que **nunca existió** en ningún
entorno (el código de `assistant/index.ts` siempre leyó `WHATSAPP_ASSISTANT_SECRET`,
desde BJ2). Era un error de documentación, no de código — se corrigió el documento.

## 3. Registrar el webhook en Meta (una vez por entorno)

Requisitos previos (checklist completo de Xaviel en §7).

1. En **Meta for Developers** → tu App → **WhatsApp** → **Configuration**:
   - **Callback URL:** `https://<ref-del-proyecto>.supabase.co/functions/v1/whatsapp-webhook`
     (dev: `https://fzfrnrvndzrjwyvdpkgg.supabase.co/functions/v1/whatsapp-webhook`).
     También visible en Tecnología › Compa en WhatsApp › Estado, ya armada.
   - **Verify Token:** el mismo valor que pusiste en el secret `WHATSAPP_VERIFY_TOKEN` de ese entorno.
   - Click **Verify and Save** — Meta hace un GET con `hub.mode=subscribe`; si el token
     coincide, el webhook responde el `hub.challenge` y Meta marca el webhook como verificado.
2. **Webhook fields:** suscribe el campo **`messages`** (no hace falta ninguno más).
3. Anota el **Phone Number ID** (no es el número de teléfono — es un ID largo que
   Meta asigna al número dentro de la app) → `WHATSAPP_PHONE_NUMBER_ID`.
4. Genera un **token permanente de System User** (no el token temporal de 24h del
   panel de pruebas) con permiso `whatsapp_business_messaging` → `WHATSAPP_TOKEN`.
5. El **App Secret** de la app (Configuración básica) → `WHATSAPP_APP_SECRET`.

## 4. Rotar el token de System User

El token permanente de Meta no expira solo, pero si se revoca o rota:
1. Meta for Developers → tu App → System Users → el usuario de WhatsApp → **Generate New Token**.
2. `node scripts/aplicar-secret.mjs --env prod WHATSAPP_TOKEN` (o `dev`) con el nuevo valor.
3. No hace falta redeploy del edge — lee el secret en cada invocación (`Deno.env.get`).
4. Verifica en Tecnología › Compa en WhatsApp › Estado que el envío de salida ya no falle con `OAuthException`.

## 5. Agregar / quitar números autorizados

Pantalla **Tecnología › Compa en WhatsApp › Autorizados** (DC7): elige el usuario
SGC, el teléfono se prellena desde su ficha si lo tiene, nota opcional, activo/inactivo,
eliminar con confirmación. Por SQL directo (equivalente, solo si hace falta):
```sql
insert into sgc.whatsapp_autorizados (telefono, usuario_id, nota)
values ('8091234567', '<uuid-del-usuario>', 'autorizado desde SQL');
```
El matching de teléfono es por los **últimos 10 dígitos** (`sgc.whatsapp_resolver`,
BJ2) — funciona igual con o sin el `1` de país que antepone WhatsApp.
**Apagar un número es inmediato:** `activo=false` corta el acceso en el siguiente
mensaje que mande (no hay caché).

## 6. Leer la actividad / diagnosticar

Pantalla **Tecnología › Compa en WhatsApp › Actividad**: filtra por teléfono/usuario,
estado, rango de fecha. El detalle técnico del error (`whatsapp_mensajes.error`)
solo lo ve `es_desarrollador()` (BS2) — a todos los demás se les traduce el estado.

Por SQL (solo SELECT, regla 19):
```sql
select direccion, telefono, tipo, estado, texto, error, creado_en
from sgc.whatsapp_mensajes
where telefono = '8091234567'
order by creado_en desc limit 20;
```

## 7. Checklist de Meta para Xaviel (antes de probar con un número real)

1. **Business Portfolio** saludable en Meta Business Suite (sin restricciones).
2. El número **+1 829-619-1631 NO debe estar activo en la app de WhatsApp**
   (ni WhatsApp Business ni personal) — Meta no deja migrar un número en uso sin
   un paso de verificación aparte; lo más simple es partir de un número que
   nunca haya abierto WhatsApp.
3. Crear la **app de Meta en modo Desarrollo** con el producto **WhatsApp** añadido.
4. Usar primero el **número de prueba que Meta regala** (gratis, sin verificar
   tarjeta) para todo el checklist de abajo — permite probar sin arriesgar el
   número real hasta que todo funcione.
5. Crear el **System User** con rol admin sobre la app + generar su **token permanente**.
6. Copiar el **App Secret**.
7. Elegir un **Verify Token** (cualquier string largo que tú definas).
8. Suscribir el webhook al campo **`messages`** (paso 3 arriba) usando la URL de
   **dev** primero.
9. Agregar un **método de pago** en Meta Business (obligatorio para pasar de
   número de prueba a número real — no se cobra nada si el volumen es bajo,
   WhatsApp Business API tiene conversaciones de servicio gratis).
10. Enviar la app a **revisión de Meta** para el permiso `whatsapp_business_messaging`
    si se va a usar fuera del modo Desarrollo (en Desarrollo, hasta 5 números de
    prueba autorizados por ti mismo en el panel funcionan sin revisión — suficiente
    para todo el QA de dev).
11. Revisar el **nombre para mostrar** del número (display name) — Meta lo aprueba
    aparte; usar algo reconocible como "Compa — SGC Constructora SD".

## 8. Límites conocidos (v1)

- **1 a 1 solamente** — no hay soporte de grupos de WhatsApp.
- **Ventana de 24 horas** de Meta: si el usuario no ha escrito en las últimas 24h,
  un mensaje de Compa iniciado por el sistema (no hay ninguno hoy — Compa solo
  responde, nunca inicia) necesitaría una plantilla aprobada por Meta. No aplica
  todavía porque Compa es 100% reactivo.
- **Nada se confirma desde el chat.** Toda `proponer_*` llega como un enlace a
  `/borrador/:id` (o al formulario real, para `preparar_echada`) — la persona
  confirma con su sesión real en SGC o la app. El branch `ejecutar` rechaza
  cualquier intento de confirmar por WhatsApp (403).
- **Solo texto y nota de voz.** Imagen/documento/video/sticker/ubicación → Compa
  responde que por ahora no los lee.
- **Memoria de 30 minutos.** Si pasan más de 30 min sin mensajes, la próxima
  pregunta abre una conversación nueva automáticamente (sin que el usuario tenga
  que escribir "nuevo"). Para reiniciar a propósito: "nuevo", "reiniciar" o "/nuevo".

## 9. Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Meta no verifica el webhook (GET falla) | `WHATSAPP_VERIFY_TOKEN` no coincide, o el secret no está seteado en ese entorno | Revisa Tecnología › Estado — el pill de `WHATSAPP_VERIFY_TOKEN` debe estar en verde; confirma que el valor en Meta es idéntico |
| Meta reintenta el mismo mensaje muchas veces | El webhook tardó más de ~10-20s en responder 200 | No debería pasar — el 200 sale ANTES de procesar (`EdgeRuntime.waitUntil`). Si pasa, revisa logs de la función (puede ser un cold-start lento) |
| `401 Invalid signature` en los logs | `WHATSAPP_APP_SECRET` no coincide con la app de Meta que manda el webhook | Verifica que apuntaste la app correcta y que el secret está actualizado en el entorno correcto |
| Los envíos de salida fallan con `OAuthException` / `Cannot parse access token` | `WHATSAPP_TOKEN` es un placeholder o venció | Generar/rotar el token permanente (§4) |
| Un número autorizado no recibe respuesta | Revisa Tecnología › Actividad por ese teléfono: si no hay fila de entrada, Meta no mandó el webhook (revisar suscripción al campo `messages`); si hay fila `no_autorizado`, el número no está en la lista (o está con `activo=false`) |
| "La ventana de 24h expiró" (error de Meta) | No debería pasar en v1 (Compa nunca inicia conversación) — si aparece, es un bug, repórtalo |
| Nota de voz no se transcribe | `STT_API_KEY` no configurado en ese entorno — Compa avisa "por ahora no puedo escuchar notas de voz" y lo registra como `ignorado` | Configurar `STT_API_KEY`/`STT_PROVIDER` (mismo secret que ya usa `transcribe-audio`) |

## 10. Qué quedó retirado (no borrado)

El puente **n8n + Evolution API** (stack WSL Docker, skill `ws-ops`) queda
**retirado de este flujo** — ya no es necesario para que Compa responda por
WhatsApp. No se tocó `public.n8n_chat_histories` ni el stack de Docker en esta
ronda; pueden apagarse/eliminarse más adelante si Xaviel confirma que no se usan
para nada más. El modo `x-wa-secret` de `assistant/index.ts` (BJ2) **sigue siendo
el mismo** — es justamente lo que este nuevo webhook reutiliza; no hubo que
tocarlo para el reemplazo del transporte.
