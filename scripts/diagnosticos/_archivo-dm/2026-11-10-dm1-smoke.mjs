import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('6 skills sembradas', `select slug, estado, ambito from sgc.claude_skills order by slug;`);
await q('pack setup-inicial items', `select tipo_item, titulo, orden from sgc.claude_pack_items pi join sgc.claude_packs p on p.id=pi.pack_id where p.slug='setup-inicial' order by orden;`);
await q('bucket claude-skills', `select id, public from storage.buckets where id='claude-skills';`);
await q('claude_org_info singleton', `select id, plan, owners from sgc.claude_org_info;`);
