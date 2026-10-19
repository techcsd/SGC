# Release 1.194.0

- Equipo/tester: Claude Code (sesión autónoma, ronda CR — PROMPT-104)
- Qué se probó en dev (fzfrnrvndzrjwyvdpkgg), con evidencia real (no solo "debería funcionar"):
  - **Servidor OAuth de Supabase** activado por API; discovery (`/.well-known/oauth-authorization-server/auth/v1`), registro dinámico de un cliente con el `redirect_uri` real de Claude (201, `client_type: public`).
  - **Edge `mcp`**: 401+`WWW-Authenticate` sin token; `tools/list` correcto por rol (49 tools para admin, 19 para un rol de un solo módulo); `tools/call quien_soy` = identidad real; `listar_almacenes` denegado server-side a quien no tiene el módulo; interruptor general → 503; sin consentimiento de IA → 403; límite por hora leído del parámetro.
  - **`/oauth/consent`**: capturado con los datos reales de un cliente registrado hoy (1440 y 390 px); bloqueo visual+funcional de un cliente no-Claude verificado.
  - **Borradores**: `proponer_tarea` por MCP → NO crea la tarea (verificado contando filas antes/después); `claude-borrador` `get` con nombres resueltos; `confirmar` crea la tarea real UNA sola vez aunque se confirme dos veces (verificado: 1 fila en `sgc.tareas` tras 2 confirmaciones); campana in-app verificada en `sgc.notificaciones`.
  - **Seguridad**: 11 RPC + 11 edges `admin-*` rechazan un JWT con `client_id` simulado (42501) y siguen funcionando igual para sesiones normales; `claude-conexiones` desconectar/revocar probados (incluida la revocación como admin para otra persona); `buscar_usuarios` por MCP ya no trae email. **Hallazgo y arreglo no planeado**: `get_resend_api_key()` en dev tenía grant público (cualquiera sin login podía pedir la API key de Resend) — corregido, dev quedó igual que prod.
  - **Admin › Claude** y **Perfil › Claude**: capturadas con datos reales de todas las pruebas de arriba (10-11 consultas, borradores, 2 personas conectadas); el interruptor probado con clics reales en el navegador (Activo → Apagado → Activo, persistido).
  - `evals/mcp/run.mjs` (10/10) y `scripts/compa-evals.mjs` (12/12) verdes tras cada redeploy.
  - `npm run build` (28 guards) + `npm run test:unit` (71/71) verdes.
- Versión de origen: 1.193.0 (sin cambios de servidor que rompan nada existente — Compa verificado sin regresión en cada paso).
- Resultado: OK
- Fecha: 2026-10-19

OK: Xaviel autorizó promover todo a producción, 2026-10-19 ("i give u my OK, do all the stuff").

Contexto de ese OK (texto literal de Xaviel en el chat, 2026-10-19): *"el owner es
Eduardo NG y el primary Owner es Ramon, i can ask him to make my a primary owner
if its needed to do all the proccess and things, just let me know. U can do the
test by urself. and i give u my OK, do all the stuff."* Owner de Claude Team =
Eduardo NG, Primary Owner = Ramon (ofreció pedir que a él también lo hagan
Primary Owner si hiciera falta — para esta promoción eso ya alcanza con que
Eduardo agregue el conector, es Owner). Dio el OK explícitamente aceptando que
Claude Code haga la prueba de Claude Desktop por su cuenta en vez de esperar su
prueba manual.

## Límites de la prueba (aceptados por Xaviel con su OK, no bloquean la promoción)
1. **Claude Desktop real**: es una app nativa de escritorio — Claude Code no
   puede abrirla desde esta sesión. Lo que SÍ se hizo: el protocolo MCP completo
   de punta a punta (equivalente a lo que probaría MCP Inspector) contra dev, y
   se repite contra prod tras el despliegue.
2. El flujo completo de `/oauth/consent` (aprobar/denegar) no se pudo ejercitar
   desde `localhost` por el chequeo de `Origin` del servidor OAuth de Supabase
   (docs/CLAUDE-CONECTOR.md §5b) — verificado con datos reales inyectados en la
   respuesta de red, y la mecánica de fondo con `curl` usando el `Origin`
   correcto. La prueba interactiva completa queda para cuando alguien lo
   conecte desde Claude Desktop real.
