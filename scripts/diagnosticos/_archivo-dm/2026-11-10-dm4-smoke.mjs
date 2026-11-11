import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error esperado) ${e.message.slice(0,200)}`); }
}
await q('que_puedo_consultar incluye claude_skills', `select modulo, puede_ver, herramientas from sgc.que_puedo_consultar() where modulo='claude_skills';`);
await q('mis_skills_claude apagado (debe fallar)', `select * from sgc.mis_skills_claude();`);
// Prender temporalmente, probar, apagar de nuevo.
await dbQuery(env, `update sgc.parametros set valor='true' where clave='claude_skills_conector';`);
await q('mis_skills_claude ENCENDIDO (debe listar)', `select slug, estado from sgc.mis_skills_claude() limit 3;`);
await q('leer_skill_claude ENCENDIDO', `select left(sgc.leer_skill_claude('pedir-bien-a-la-ia'), 80) as texto;`);
await dbQuery(env, `update sgc.parametros set valor='false' where clave='claude_skills_conector';`);
await q('vuelto a apagar (debe fallar otra vez)', `select * from sgc.mis_skills_claude();`);
