import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function sesionDe(email) {
  const admin = await fetch(`${env.url}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await admin.json();
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  const vres = await fetch(`${env.url}/auth/v1/verify`, { method: 'POST', headers: { apikey: env.serviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }) });
  const vj = await vres.json();
  return vj.access_token;
}
const token = await sesionDe('qa_admin@constructorasd.com');
const [pack] = await dbQuery(env, `select id from sgc.claude_packs where slug='setup-inicial'`);
const res = await fetch(`${env.url}/rest/v1/claude_pack_items?pack_id=eq.${pack.id}&select=tipo_item,titulo,orden,skill_id,claude_skills(id,nombre,slug,version_actual)&order=orden`, {
  headers: { apikey: env.serviceKey, Authorization: `Bearer ${token}`, 'Accept-Profile': 'sgc' },
});
console.log(res.status);
console.log(JSON.stringify(await res.json(), null, 2));
