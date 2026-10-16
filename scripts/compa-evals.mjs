// scripts/compa-evals.mjs — CP3/CP9 (PROMPT-100 F4.7) — corre los casos de
// supabase/functions/assistant/evals/casos.json contra la edge `assistant`
// desplegada en el entorno dado (SIEMPRE dev para esta gate; prod solo para
// diagnóstico manual). Para cada caso: resuelve un usuario real de ese rol,
// abre su sesión (magic link, sin tocar su contraseña — mismo patrón que el
// puente de WhatsApp en index.ts), llama la edge, y valida las expectativas.
//
//   node scripts/compa-evals.mjs --env dev
//   node scripts/compa-evals.mjs --env dev --solo hector-almacenes,admin-vehiculos
//
// Exit code 1 si algún caso falla (para que release-check.mjs lo use como gate).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = await resolverEnv(process.argv.slice(2));
const soloIdx = process.argv.indexOf('--solo');
const solo = soloIdx !== -1 ? new Set(process.argv[soloIdx + 1].split(',')) : null;

const { casos } = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/assistant/evals/casos.json'), 'utf8'));
const casosACorrer = solo ? casos.filter((c) => solo.has(c.id)) : casos;

async function dbq(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

async function usuarioParaRol(rolCodigo, email) {
  if (email) {
    const [u] = await dbq(`select id, nombre, email from sgc.usuarios where email = '${email}'`);
    return u ?? null;
  }
  const [u] = await dbq(`
    select u.id, u.nombre, u.email from sgc.usuarios u
    join sgc.usuarios_roles ur on ur.usuario_id = u.id
    join sgc.roles r on r.id = ur.rol_id
    where r.codigo = '${rolCodigo}' and coalesce(u.activo, true)
      and u.email not ilike 'revision.%' and u.nombre not ilike '%demo%' and u.nombre not ilike '%(revisión)%'
    order by (u.email ilike 'qa\\_%') desc, u.nombre asc
    limit 1`);
  return u ?? null;
}

async function sesionDe(email) {
  // Mismo patrón que el puente de WhatsApp en index.ts: generamos un magic link
  // con la service role key (GoTrue del proyecto) y lo verificamos para obtener
  // un access_token real, SIN tocar la contraseña del usuario.
  const admin = await fetch(`${env.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await admin.json();
  // La REST API cruda de GoTrue (a diferencia del SDK supabase-js) devuelve el
  // hash en la raíz de la respuesta, no bajo `.properties`.
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`No se pudo generar sesión para ${email}: ${JSON.stringify(link).slice(0, 300)}`);
  const vres = await fetch(`${env.url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  const vj = await vres.json();
  if (!vj?.access_token) throw new Error(`No se pudo verificar sesión para ${email}: ${JSON.stringify(vj).slice(0, 300)}`);
  return vj.access_token;
}

const PROMETE_ACCION =
  /\b(procedo a|voy a (generar|crear|preparar|hacer|enviar|armar)|ahora (sí )?(genero|preparo|creo|armo|envío)|te lo (genero|preparo|armo|envío)|en un momento (te|lo|la) (genero|preparo|armo|envío)|dame un momento (para|y)|enseguida (te|lo|la) (genero|preparo|armo))\b/i;
const CONTRADICCION = /\bno tengo (esa |una )?herramienta|no puedo (hacer|consultar) eso\b/i;

async function correrCaso(caso) {
  const usuario = caso.email ? await usuarioParaRol(null, caso.email) : await usuarioParaRol(caso.rol_codigo);
  if (!usuario?.email) return { id: caso.id, ok: false, motivo: `sin usuario dev para rol '${caso.rol_codigo}'` };
  const email = usuario.email;

  let accessToken;
  try { accessToken = await sesionDe(email); }
  catch (e) { return { id: caso.id, ok: false, motivo: String(e.message).slice(0, 200) }; }

  // Los evals solo corren contra dev: nos aseguramos de que el consentimiento de
  // IA esté otorgado (CI10) para que el gate no bloquee el caso de prueba.
  if (env.entorno === 'dev' && usuario.id) {
    await dbq(`insert into sgc.consentimientos (usuario_id, tipo, otorgado, plataforma)
      values ('${usuario.id}'::uuid, 'ia', true, 'web')
      on conflict (usuario_id, tipo) do update set otorgado = true, actualizado_at = now()`).catch(() => {});
  }

  const res = await fetch(`${env.url}/functions/v1/assistant`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje: caso.mensaje }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { id: caso.id, ok: false, motivo: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`, email };

  const herramientas = data.herramientas ?? [];
  const texto = String(data.respuesta ?? '');
  const archivos = data.archivos ?? (data.archivo ? [data.archivo] : []);
  const fallos = [];
  const exp = caso.expect ?? {};

  if (exp.tool_llamada && !herramientas.some((h) => h.tool === exp.tool_llamada && h.ok)) {
    fallos.push(`no llamó '${exp.tool_llamada}' (llamó: ${herramientas.map((h) => h.tool).join(', ') || 'ninguna'})`);
  }
  if (exp.tool_llamada_una_de && !herramientas.some((h) => exp.tool_llamada_una_de.includes(h.tool) && h.ok)) {
    fallos.push(`no llamó ninguna de [${exp.tool_llamada_una_de.join(', ')}] (llamó: ${herramientas.map((h) => h.tool).join(', ') || 'ninguna'})`);
  }
  if (exp.sin_gap_falso && herramientas.some((h) => h.tool === 'reportar_gap')) {
    fallos.push('llamó reportar_gap (puede ser un gap falso — revisar a mano)');
  }
  if (exp.sin_contradiccion && CONTRADICCION.test(texto)) {
    fallos.push(`texto contradice tener herramienta: "${texto.slice(0, 120)}"`);
  }
  if (exp.sin_promesa_vacia && PROMETE_ACCION.test(texto) && !archivos.length && !data.propuesta) {
    fallos.push(`prometió sin ejecutar: "${texto.slice(0, 120)}"`);
  }
  if (exp.requiere_archivo && !archivos.length) {
    fallos.push('no entregó ningún archivo');
  }

  return { id: caso.id, ok: fallos.length === 0, fallos, email, herramientas: herramientas.map((h) => h.tool), texto: texto.slice(0, 160) };
}

console.log(`Corriendo ${casosACorrer.length} caso(s) de Compa contra ${env.entorno} (${env.ref})…\n`);
const resultados = [];
for (const caso of casosACorrer) {
  const r = await correrCaso(caso);
  resultados.push(r);
  const icono = r.ok ? '✅' : '🔴';
  console.log(`${icono} ${r.id}${r.email ? ` (${r.email})` : ''}`);
  if (!r.ok) console.log(`   ${r.motivo ?? (r.fallos ?? []).join(' · ')}`);
  if (r.herramientas) console.log(`   herramientas: ${r.herramientas.join(', ') || '(ninguna)'} · "${r.texto}"`);
}

const okCount = resultados.filter((r) => r.ok).length;
console.log(`\n${okCount}/${resultados.length} casos OK.`);

const reportePath = join(ROOT, 'qa', `compa-evals-${env.entorno}.json`);
writeFileSync(reportePath, JSON.stringify({ corrido_en: new Date().toISOString(), entorno: env.entorno, resultados }, null, 2));
console.log(`Reporte: ${reportePath}`);

if (okCount < resultados.length) process.exit(1);
