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
- Resultado: **sin pruebas de Xaviel todavía.**
- Fecha: 2026-10-19

## Pendiente — NO se puede marcar OK sin esto
1. **Prueba real con Claude Desktop** (MCP Inspector cubrió el protocolo, pero no
   reemplaza conectar con la app real — necesita que exista un Owner/Primary
   Owner de la cuenta Claude Team de la empresa, ver la lista de pedidos).
2. El flujo completo de `/oauth/consent` (aprobar/denegar reales) no se pudo
   probar contra `localhost` por el chequeo de `Origin` del servidor OAuth de
   Supabase (docs/CLAUDE-CONECTOR.md §5b) — se verificó con datos reales
   inyectados en la respuesta de red, y la mecánica de fondo con `curl` usando
   el `Origin` correcto. La prueba interactiva real solo se puede hacer una vez
   desplegado en `dev.sgcconstructorasd.com`.
3. Xaviel revisa este registro y da el OK (línea `OK: <fecha>` en este archivo)
   antes de promover — `release-check.mjs` (CR3) ya NO acepta un OK sin fecha o
   con "pendiente/falta/no/skip" cerca.
