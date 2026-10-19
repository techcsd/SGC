// evals/mcp/run.mjs — CR1 (FASE 7) — contrato del servidor `mcp` contra un
// entorno real. Reusa el patrón de sesión de scripts/compa-evals.mjs (magic
// link vía service role, sin tocar contraseñas).
//
//   node evals/mcp/run.mjs --env dev
//
// Exit code 1 si algún caso falla. No corre en `prebuild` (necesita red real
// contra Supabase) — se invoca con `npm run test:mcp`.
import '../../scripts/lib/load-env.mjs';
import { resolverEnv } from '../../scripts/lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const anonKey = process.env[`SUPABASE_ANON_KEY_${env.entorno.toUpperCase()}`];
if (!anonKey) { console.error(`🔴 falta SUPABASE_ANON_KEY_${env.entorno.toUpperCase()}`); process.exit(1); }

const fails = [];
const oks = [];
function check(nombre, cond, detalle = '') {
  if (cond) { oks.push(nombre); console.log(`✅ ${nombre}`); }
  else { fails.push(`${nombre}${detalle ? ' — ' + detalle : ''}`); console.log(`🔴 ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}

async function dbq(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function sesionDe(email) {
  const admin = await (await fetch(`${env.url}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })).json();
  const tokenHash = admin?.hashed_token ?? admin?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`no se pudo generar sesión para ${email}`);
  const vres = await fetch(`${env.url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  const vj = await vres.json();
  if (!vj?.access_token) throw new Error(`no se pudo verificar sesión para ${email}: ${JSON.stringify(vj).slice(0, 200)}`);
  return vj.access_token;
}

async function mcp(token, method, params) {
  const r = await fetch(`${env.url}/functions/v1/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} }),
  });
  const text = await r.text();
  const m = text.match(/data: (.+)/);
  const json = m ? JSON.parse(m[1]) : (() => { try { return JSON.parse(text); } catch { return null; } })();
  return { status: r.status, json };
}

async function usuarioDeRol(codigo) {
  const rows = await dbq(`
    select u.email from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where r.codigo = '${codigo}' and coalesce(u.activo, true) and u.email ilike 'qa%'
    order by (u.email ilike 'qa\\_%') desc limit 1`);
  return rows[0]?.email ?? null;
}

async function asegurarConsentimientoIA(email, token) {
  await fetch(`${env.url}/rest/v1/rpc/set_consentimiento`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'Content-Profile': 'sgc' },
    body: JSON.stringify({ p_tipo: 'ia', p_otorgado: true, p_plataforma: 'web' }),
  }).catch(() => {});
}

console.log(`▶ evals/mcp — contrato del servidor mcp contra ${env.entorno} (${env.ref})\n`);

// ── 1) tools/list por rol: admin ve más que un rol de un solo módulo ────────
const emailAdmin = (await usuarioDeRol('admin')) ?? 'qa_admin@constructorasd.com';
const emailTec = (await usuarioDeRol('tecnologia')) ?? 'qa_tecnologia@constructorasd.com';
const tokAdmin = await sesionDe(emailAdmin);
const tokTec = await sesionDe(emailTec);
await asegurarConsentimientoIA(emailAdmin, tokAdmin);
await asegurarConsentimientoIA(emailTec, tokTec);

const listAdmin = await mcp(tokAdmin, 'tools/list');
const listTec = await mcp(tokTec, 'tools/list');
const toolsAdmin = listAdmin.json?.result?.tools ?? [];
const toolsTec = listTec.json?.result?.tools ?? [];
check('tools/list admin trae más de 40 herramientas', toolsAdmin.length > 40, `trajo ${toolsAdmin.length}`);
check('tools/list de un rol de un solo módulo trae MENOS que admin', toolsTec.length < toolsAdmin.length, `${toolsTec.length} vs ${toolsAdmin.length}`);
check('ninguna tool expone generar_reporte_pdf (canal compa-only)', !toolsAdmin.some((t) => t.name === 'generar_reporte_pdf'));
check('ninguna tool expone recordar (canal compa-only)', !toolsAdmin.some((t) => t.name === 'recordar'));

// ── 2) una lectura por MCP = el mismo dato que el RPC directo ───────────────
const mcpQuienSoy = await mcp(tokAdmin, 'tools/call', { name: 'quien_soy', arguments: {} });
const mcpTxt = mcpQuienSoy.json?.result?.content?.[0]?.text ? JSON.parse(mcpQuienSoy.json.result.content[0].text) : null;
const rpcDirecto = await fetch(`${env.url}/rest/v1/rpc/quien_soy`, {
  method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${tokAdmin}`, 'content-type': 'application/json', 'Content-Profile': 'sgc' },
  body: '{}',
}).then((r) => r.json());
check('quien_soy por MCP = quien_soy() por RPC directo (mismo usuario)', mcpTxt?.usuario_id === rpcDirecto?.usuario_id,
  `mcp=${mcpTxt?.usuario_id} rpc=${rpcDirecto?.usuario_id}`);

// ── 3) un rol sin módulo recibe "no tengo acceso" (no un error genérico) ────
const sinAcceso = await mcp(tokTec, 'tools/call', { name: 'listar_almacenes', arguments: {} });
const sinAccesoTxt = sinAcceso.json?.result?.content?.[0]?.text ?? '';
check('rol sin módulo inventario: tool no disponible o acceso denegado', sinAcceso.json?.result?.isError === true, sinAccesoTxt);

// ── 4) proponer_* crea un borrador, NUNCA la tarea real ──────────────────────
const [{ id: proyectoId } = {}] = await dbq(`select id from sgc.proyectos where es_prueba=false and activo=true limit 1`);
const antes = await dbq(`select count(*)::int as n from sgc.tareas where titulo = 'EVAL MCP — no debe crearse'`);
const propuesta = await mcp(tokAdmin, 'tools/call', { name: 'proponer_tarea', arguments: { proyecto_id: proyectoId, titulo: 'EVAL MCP — no debe crearse' } });
const despues = await dbq(`select count(*)::int as n from sgc.tareas where titulo = 'EVAL MCP — no debe crearse'`);
check('proponer_tarea NO crea la tarea (solo un borrador)', antes[0].n === despues[0].n, `antes=${antes[0].n} despues=${despues[0].n}`);
const propTxt = propuesta.json?.result?.content?.[0]?.text ? JSON.parse(propuesta.json.result.content[0].text) : null;
check('proponer_tarea devuelve borrador_id + url', !!propTxt?.borrador_id && !!propTxt?.url);
if (propTxt?.borrador_id) await dbq(`update sgc.claude_borradores set estado='descartado' where id='${propTxt.borrador_id}'`);

// ── 5) negativas ──────────────────────────────────────────────────────────
const sinToken = await mcp(null, 'tools/list');
check('sin token → 401', sinToken.status === 401, `status=${sinToken.status}`);

const toolInexistente = await mcp(tokAdmin, 'tools/call', { name: 'esto_no_existe', arguments: {} });
check('tool inexistente → isError', toolInexistente.json?.result?.isError === true);

console.log(`\n${oks.length} OK, ${fails.length} fallo(s).`);
if (fails.length) process.exit(1);
