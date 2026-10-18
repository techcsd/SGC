# Claude Desktop ↔ SGC — el conector MCP (CR1)

> Qué es esto y por qué existe: Eduardo NG pidió poder usar el SGC desde **Claude
> Desktop** (su propia cuenta, su propio modelo) sin pasar por Compa. La vía
> correcta (no es "la API de Claude" — eso es para que *nuestro* código le hable a
> Claude) es un **servidor MCP remoto** dentro de Supabase, con **login OAuth por
> persona**: cada quien conecta con su cuenta del SGC y Claude solo ve lo que esa
> persona ve. Contexto completo: `CONTEXTO-ACTUALIZACION-51.md` (`imp 18102026`).

**Lo confirmado hoy (18-oct-2026), con fecha, releyendo las fuentes actuales** (no
de memoria — esto es beta y cambia):

## 1. Claves de firma (CR2) — YA NO ES UN PROBLEMA

Verificado por API (`GET /v1/projects/{ref}/config/auth/signing-keys`, Management
API, solo lectura):

| Entorno | Clave en uso | Legado HS256 |
|---|---|---|
| **dev** (`fzfrnrvndzrjwyvdpkgg`) | `ES256`, `status: in_use`, desde **21-sep-2026** | `status: previously_used` (ya rotada) |
| **prod** (`jeeqhgccqefbqilntcpu`) | `ES256`, `status: in_use`, desde **27-jun-2026** | `status: previously_used` (ya rotada) |

**Ambos entornos ya firman con clave asimétrica.** No hace falta migrar nada —
el hallazgo CR2 del CONTEXTO-51 (que suponía que podíamos seguir en HS256) no
aplica: alguna migración anterior ya lo resolvió. Ningún riesgo de romper login,
Compa, Storage o Realtime por este cambio porque **no hay cambio que hacer**.

Fuente: [Supabase — JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
confirma que `withSupabase()` (el middleware del servidor MCP) **rechaza tokens
HS256 legacy** y exige que el proyecto firme con ES256/RS256 — por eso importaba
verificar esto primero.

## 2. El servidor OAuth 2.1 de Supabase Auth

Fuentes: [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server) ·
[Getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started) ·
[MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) ·
[Build your own MCP server](https://supabase.com/docs/guides/ai-tools/byo-mcp).

- Se activa con 3 campos en la config de Auth del proyecto: `oauth_server_enabled`,
  `oauth_server_authorization_path` (la ruta de **nuestra** pantalla de
  consentimiento, p. ej. `/oauth/consent`), `oauth_server_allow_dynamic_registration`.
- **Se puede activar por la Management API** (`PATCH /v1/projects/{ref}/config/auth`)
  — el CONTEXTO-51 no sabía si el panel era la única vía; **sí hay API**, y
  funcionó: **activado en dev hoy mismo, sin que Xaviel tuviera que hacer clic.**
- Discovery: `GET https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`
  → trae `authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
  `jwks_uri`, `code_challenge_methods_supported: ["S256","plain"]`.
- La pantalla de consentimiento la construimos nosotros con
  `supabase.auth.oauth.getAuthorizationDetails(authorization_id)` (trae
  `client.name`, `redirect_uri`, `scope`) y `.approveAuthorization(id)` /
  `.denyAuthorization(id)` (ambas devuelven `{ redirect_url }` para mandar de
  vuelta al cliente). Si el usuario ya había consentido antes,
  `getAuthorizationDetails` devuelve directo `{ redirect_url }` (sin
  `authorization_id`) → redirigir sin mostrar nada.
- Si no hay sesión: mandar a `/login?redirect=/oauth/consent?authorization_id=<id>`
  y volver con el mismo `authorization_id` tras iniciar sesión.

**Estado real en dev, verificado hoy:**
```
oauth_server_enabled = true
oauth_server_allow_dynamic_registration = true
oauth_server_authorization_path = "/oauth/consent"
```
Activado vía API hoy (18-oct). **Prod sigue apagado** (`oauth_server_enabled:
false`) — se activa en el mismo paso que el resto de FASE 9 (promoción), con OK
de Xaviel, no antes.

## 3. El servidor `mcp` (edge function)

- Patrón oficial (de `byo-mcp`): `pipeline([withOAuthProtectedResource(),
  withSupabase({auth:'user'})], handler)` de `npm:@supabase/middleware@1` +
  `npm:@supabase/server@1`, con `npm:@modelcontextprotocol/server@^2.0.0`
  (`createMcpHandler`, `McpServer`) para el protocolo MCP (Streamable HTTP) y
  `npm:zod@^4.3.6` para los schemas de cada tool.
- **Gotcha real, encontrado hoy:** el cliente que entrega `withSupabase()` NO
  tiene forma de fijar el schema por defecto (a diferencia de
  `createClient(url,key,{db:{schema:'sgc'}})` que usa `assistant/index.ts`) — se
  necesita `supabase.schema('sgc').rpc(...)` en **cada** llamada dentro del `mcp`.
  Sin esto, el error es `Could not find the function public.<rpc> in the schema
  cache` (lo confirmé probándolo: falló así, se corrigió con `.schema('sgc')`).
- `verify_jwt = false` en `supabase/config.toml` **a propósito** (comentado en el
  archivo): el gateway de Supabase no sabe validar tokens OAuth de este recurso
  (audiencia/`client_id`); `withSupabase` los valida él mismo contra el JWKS.
- El cliente MCP debe mandar `Accept: application/json, text/event-stream`
  (Streamable HTTP) — sin eso, `createMcpHandler` responde 406.

**Verificado hoy en dev (edge `mcp` v2), evidencia real:**
1. `POST /functions/v1/mcp` sin token → **401** con
   `WWW-Authenticate: Bearer resource_metadata="https://fzfrnrvndzrjwyvdpkgg.supabase.co/functions/v1/mcp/oauth-protected-resource"`.
2. Esa URL de metadata → **200**, `{"resource":".../functions/v1/mcp",
   "authorization_servers":[".../auth/v1"],"bearer_methods_supported":["header"]}`.
3. `tools/list` con un usuario real (`qa_admin`, sesión por magic link) → devuelve
   la única tool de esta fase (`quien_soy`).
4. `tools/call quien_soy` → **devuelve la identidad real del usuario**
   (`nombre, roles, modulos, es_admin, usuario_id` — igual que `sgc.quien_soy()`
   vía Compa), confirmando que `withSupabase` + RLS funcionan igual que el
   patrón de `assistant/index.ts`.
5. Token inválido/mal formado (sin `kid`) → **401**
   `INVALID_JWT` con mensaje claro.
6. **Registro dinámico de cliente probado con el `redirect_uri` real de Claude**
   (`POST /auth/v1/oauth/clients/register` con
   `redirect_uris:["https://claude.ai/api/mcp/auth_callback"]`) → **201**,
   `client_type: "public"`, `token_endpoint_auth_method: "none"` (PKCE puro, sin
   secreto — correcto para un cliente público como Claude Desktop).

**Lo que falta probar** (necesita el consentimiento real — llega con FASE 3): el
ciclo completo autorización→consentimiento→token con **MCP Inspector**
(`npx @modelcontextprotocol/inspector`) y, más adelante, con **Claude Desktop
real** (pendiente físico, ver lista de pedidos).

## 4. Claude Team — DCR vs identidad publicada (pregunta de FASE 0.2, respondida)

Fuente: [Authentication for connectors](https://claude.com/docs/connectors/building/authentication).

Claude ofrece 3 formas de identificarse ante un servidor MCP:
1. **DCR** (registro dinámico, RFC 7591) — Claude se registra solo en cada
   conexión nueva. Pensado para "listados universales".
2. **CIMD** (Client ID Metadata Document) — identidad publicada estable, para
   quien tiene una URL por cliente.
3. **Credenciales que Anthropic ya tiene** — para integraciones empresariales de
   alto tráfico.

**Respuesta aplicable al SGC: usamos DCR.** Supabase Auth no implementa CIMD ni
tiene un acuerdo con Anthropic para credenciales pre-cargadas — su servidor OAuth
expone `registration_endpoint` (RFC 7591 estándar), que es exactamente lo que DCR
necesita, y ya lo probé funcionando con el `redirect_uri` real de Claude (arriba).
En Claude Desktop, al agregar el conector personalizado, la opción correcta es
**"Register automatically"** (no "Use Claude's published identity", que
necesitaría que Supabase soportara CIMD — no lo hace hoy).

**`redirect_uri` de Claude (lista blanca para FASE 3.4):**
- `https://claude.ai/api/mcp/auth_callback` (Claude.ai web, Desktop, móvil, Cowork)
- `https://claude.com/api/mcp/auth_callback` (alias, algunas superficies)
- Claude Code usa loopback (`http://localhost:{puerto}/callback`) — **no aplica**
  aquí: esta ronda es para usuarios del SGC en Claude Desktop/web, no para Claude
  Code conectándose como agente.

PKCE: Claude siempre manda `code_challenge_method=S256` — el discovery de
Supabase ya lo anuncia (`code_challenge_methods_supported`).

**En Team/Enterprise**: solo Owners/Primary Owners agregan el conector a nivel
organización; luego cada miembro lo conecta con su propia cuenta del SGC (eso es
lo que ya decía el CONTEXTO-51, confirmado por la doc de Claude).

## 5. Pendiente de verificar con el MCP Inspector / Claude Desktop real
El flujo manual (curl + magic link) ya prueba que el servidor responde correcto
en cada paso. Falta la prueba **interactiva** real:
- `npx @modelcontextprotocol/inspector` contra
  `https://fzfrnrvndzrjwyvdpkgg.supabase.co/functions/v1/mcp` → flujo completo de
  browser (registro → `/oauth/consent` → token → `tools/call`). **La pantalla
  `/oauth/consent` todavía no existe (llega en FASE 3)** — hasta entonces, el
  Inspector puede probar discovery/401/tools pero no el consentimiento completo.
- Con Claude Desktop real: pendiente físico (ver lista de pedidos).

## 6. Diagnóstico — qué mirar si algo falla
- **"Connect" falla / no aparece el conector** → revisar que
  `oauth_server_enabled=true` en el entorno correcto y que el `redirect_uri` que
  mandó el cliente esté en la lista blanca (si no, nuestra pantalla de
  consentimiento lo bloquea con aviso rojo — FASE 3.4).
- **401 al llamar una tool** → token expirado, de otra audiencia, o
  `claude_conector_activo=false`/`claude_conector_solo_autorizados=true` sin
  estar en la lista (FASE 2 parámetros) — mensaje siempre explica cuál.
- **503** → interruptor general apagado (`claude_conector_activo`).
- **429 / límite** → `claude_conector_max_hora` (120/persona/hora).
- **`Could not find the function public.X`** → falta `.schema('sgc')` en esa
  llamada nueva (gotcha de arriba).
- **Apagar/revocar** → Admin › Claude (interruptor general) o Perfil › Claude /
  Admin › Claude → Revocar (por persona) — FASE 5/6.

## 7. Lista blanca de clientes (para FASE 3.4)
```
https://claude.ai/api/mcp/auth_callback
https://claude.com/api/mcp/auth_callback
```
Cualquier cliente registrado con otro `redirect_uri` → aviso rojo en
`/oauth/consent`, bloqueado salvo `claude_conector_clientes_extra=true`.

## 8. RPC de alto riesgo (se completa en FASE 5)
Placeholder — el inventario real de funciones que deben rechazar tokens OAuth
(`auth.jwt() ->> 'client_id' is not null`) se arma y documenta aquí en FASE 5.
