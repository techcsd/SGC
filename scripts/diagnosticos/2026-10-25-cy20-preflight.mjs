import '../lib/load-env.mjs';
import fs from 'node:fs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const sql = fs.readFileSync('docs/odoo-schema/00_preflight.sql', 'utf8');
// dbQuery (Management API) ejecuta el bloque completo; para ver cada SELECT
// por separado los partimos en las consultas tal cual estan en el archivo.
const bloques = sql.split(/\n\n+/).filter((b) => b.trim() && !b.trim().startsWith('--') || /select/i.test(b));
for (const b of bloques) {
  const limpio = b.trim();
  if (!limpio || limpio.split('\n').every((l) => l.trim().startsWith('--'))) continue;
  console.log('\n=== bloque ===\n' + limpio.slice(0, 120).replace(/\n/g, ' ') + '...');
  try {
    const r = await dbQuery(env, limpio);
    console.log(JSON.stringify(r, null, 1));
  } catch (e) { console.log('ERROR: ' + e.message); }
}
