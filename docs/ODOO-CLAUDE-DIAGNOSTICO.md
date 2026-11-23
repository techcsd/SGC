# Odoo ↔ SGC ↔ Claude — diagnóstico (ronda DX, 23-nov-2026)

Nota 15: «odoo connection with sgc and claude isn't working». Hay **tres** caminos distintos; solo uno estaba roto.

## 12.1 SGC ↔ Odoo — SANO (verificado en prod, solo lectura)
| Señal | Valor 23-nov ~19:00 UTC |
|---|---|
| Crons `sgc-odoo-sync`, `-conciliar-diario`, `-conciliar-sondeo`, `-alertar-publicacion`, `-alertar-sondeo-caido` | los 5 activos; `odoo-sync` corrió a las 18:57 UTC (cada minuto) |
| Intentos con error en 24 h | **1**: «TIES 80CM no está vinculado con Odoo: homológalo en Tecnología › Homologación» (artículo libre de la requisición REQ-000182, rechazada) — error de datos, no de conexión |
| Conduces en modo degradado | **0** |
| Discrepancias abiertas | 24 `picking_a_no_validado` (HANDOFF decía 35), 11 `fuera_de_canal` (decisión de Xaviel), 1 `transito_vencido` — **sin ejecutar**, decisión de Raykler/logística |
| Secrets (solo nombres) | `ODOO_URL/DB/USER/API_KEY/COMPANY_ID/SYNC_SECRET/HOSTS_*/ESCRITURA_HABILITADA/PERMITIR_PROD` presentes en prod |

La nueva fila **«Sincronización con Odoo»** de Pulso del sistema (`sql/2026-11-23-dx3-pulso-resiliente.sql`) deja esto visible sin SQL.

## 12.2 Claude Desktop ↔ Odoo directo — ESTE es el que falla (foto de Raykler)
El reporte `12295fd3` («error al reconectarse a odoo») trae una captura de **Claude Desktop** en el PC de Raykler:
- Conector `odoo` — «Error al conectar» — «Configurado en tu configuración de usuario de Claude Code (`~/.claude.json`)».
- Detalle: `Connection closed`. Toast: «No se pudo reconectar odoo: Connection closed».
- «Conectores · **189 por reconectar**». La conversación ofrece «/mcp» o «/odoo-tools:odoo-setup-mcp».
- Es decir: un servidor MCP **local** (proceso stdio) que arranca y se cierra solo. **No es una pantalla ni una edge de SGC**; no hay nada en `claude-conexiones`/`odoo_instancias` que lo gobierne.

### Guía de pruebas paso a paso (para Xaviel, en el PC de Raykler)
1. En Claude Desktop → Configuración → Conectores → `odoo` → **Ver detalles**: copiar el comando (`command`/`args`) y la URL/base que usa.
2. Abrir `~/.claude.json` (Windows: `C:\Users\<usuario>\.claude.json`), buscar `mcpServers` → `odoo`: confirmar `command` (¿`npx`/`uvx`/`node`?), `args`, y que las variables (`ODOO_URL`, `ODOO_DB`, usuario, API key) existan **sin pegarlas en el chat**.
3. Ejecutar ese mismo `command` + `args` en una terminal: si imprime un error antes de cerrarse (Node/Python no instalado, paquete no descargable, credencial inválida), ese es el motivo real de `Connection closed`.
4. Comprobar la URL: la base real de prod es la de `ODOO_URL` (Cloudpepper); el staging responde 502 (del proveedor) y NO sirve para pruebas.
5. Credencial: la API key de Odoo caduca o se revoca; si el paso 3 dice 401/AccessDenied, generar una nueva en Odoo (Preferencias → Seguridad de cuenta → Claves API) y guardarla en la configuración local del conector, no en SGC.
6. Reconectar con «Reconectar» o `/mcp`. Si persiste: `/odoo-tools:odoo-setup-mcp` para regenerar la configuración.
7. Verificación final: pedirle a Claude «lista 3 órdenes de compra» (solo lectura).

> No se creó ni se «arregló» ningún conector: está fuera de los repos.

## 12.3 Claude/Compa ↔ Odoo vía SGC — NO existe todavía (no iniciado en esta ronda)
Confirmado: cero menciones de Odoo en `mcp/index.ts`, `assistant/index.ts`, `_shared/herramientas.ts`. Diseño propuesto (pendiente, **solo lectura**): `consultar_stock_odoo`, `consultar_oc_odoo`, `estado_sincronizacion_odoo` implementadas una sola vez en `_shared/herramientas.ts`, llamando a `odoo-api` con la guardia de host, tope de 50 filas, permisos inventario/compras/admin, interruptor `parametros.odoo_herramientas_ia` apagado, matriz `PERMISOS-TOOLS.md` y evals. Contabilidad de Odoo queda fuera.
