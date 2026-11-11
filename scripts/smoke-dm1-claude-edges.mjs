// smoke-dm1-claude-edges.mjs — DM1. Prueba las 3 edges del módulo Claude
// (claude-skill-validar, claude-skill-descargar, claude-pack-zip) contra dev
// por HTTP real, con sesión de qa_admin@constructorasd.com.
//
//   node scripts/smoke-dm1-claude-edges.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
import { writeFileSync } from 'node:fs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 Este smoke solo corre contra dev.'); process.exit(1); }

async function sesionDe(email) {
  const admin = await fetch(`${env.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await admin.json();
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  const vres = await fetch(`${env.url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  const vj = await vres.json();
  if (!vj?.access_token) throw new Error(`No se pudo verificar sesión: ${JSON.stringify(vj).slice(0, 300)}`);
  return vj.access_token;
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLO: ' + msg);
  console.log('OK:', msg);
}

const [qaAdmin] = await dbQuery(env, `select u.id, u.email from sgc.usuarios u where u.email='qa_admin@constructorasd.com' limit 1`);
if (!qaAdmin?.email) throw new Error('No existe qa_admin@constructorasd.com en este entorno.');
const token = await sesionDe(qaAdmin.email);
const apikey = env.serviceKey;

// 1) claude-skill-validar — secreto duro debe rechazar.
{
  const form = new FormData();
  form.append('slug', 'skill-con-secreto');
  form.append('archivo', new Blob(['---\nname: skill-con-secreto\ndescription: trae una clave\n---\nsk-ant-abcdefghijklmnop'], { type: 'text/markdown' }), 'SKILL.md');
  const res = await fetch(`${env.url}/functions/v1/claude-skill-validar`, {
    method: 'POST', headers: { apikey, Authorization: `Bearer ${token}` }, body: form,
  });
  const body = await res.json();
  assert(body.ok === false && body.errores.some((e) => /Anthropic/.test(e)), `secreto duro rechazado (${JSON.stringify(body)})`);
}

// 2) claude-skill-validar — skill válida, guarda y versiona.
let skillId;
{
  const form = new FormData();
  form.append('slug', 'smoke-dm1-skill');
  form.append('nombre', 'Smoke DM1');
  form.append('descripcion', 'Skill de prueba del smoke DM1.');
  form.append('archivo', new Blob(['---\nname: smoke-dm1-skill\ndescription: skill de prueba\n---\n# contenido'], { type: 'text/markdown' }), 'SKILL.md');
  const res = await fetch(`${env.url}/functions/v1/claude-skill-validar`, {
    method: 'POST', headers: { apikey, Authorization: `Bearer ${token}` }, body: form,
  });
  const body = await res.json();
  assert(res.status === 200 && body.ok === true && body.skill_id, `skill válida guardada (${JSON.stringify(body)})`);
  skillId = body.skill_id;
}

// 3) claude-skill-descargar — zip con LEEME.
{
  const res = await fetch(`${env.url}/functions/v1/claude-skill-descargar`, {
    method: 'POST', headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill_id: skillId }),
  });
  assert(res.status === 200 && res.headers.get('content-type') === 'application/zip', `descarga individual devuelve zip (status=${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync('scripts/.smoke-dm1-skill.zip', buf);
  assert(buf.length > 100, `zip no vacío (${buf.length} bytes)`);
}

// 4) claude-pack-zip — paquete Setup inicial.
{
  const [pack] = await dbQuery(env, `select id from sgc.claude_packs where slug='setup-inicial'`);
  const res = await fetch(`${env.url}/functions/v1/claude-pack-zip`, {
    method: 'POST', headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack_id: pack.id }),
  });
  assert(res.status === 200 && res.headers.get('content-type') === 'application/zip', `zip del pack Setup inicial (status=${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync('scripts/.smoke-dm1-pack.zip', buf);
  assert(buf.length > 1000, `zip del pack no vacío (${buf.length} bytes)`);
}

console.log('\n✓ Todos los smokes de DM1 pasaron.');
