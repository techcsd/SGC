import '../lib/load-env.mjs';
import fs from 'node:fs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const [, , archivo, ...rest] = process.argv;
const env = await resolverEnv(rest);
const sql = fs.readFileSync(archivo, 'utf8');
const bloques = sql.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
for (const b of bloques) {
  const sinComentarios = b.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
  if (!sinComentarios) continue;
  console.log('\n=== ' + sinComentarios.slice(0, 100).replace(/\n/g, ' ') + ' ===');
  try { console.log(JSON.stringify(await dbQuery(env, sinComentarios), null, 1)); }
  catch (e) { console.log('ERROR: ' + e.message.slice(0, 300)); }
}
