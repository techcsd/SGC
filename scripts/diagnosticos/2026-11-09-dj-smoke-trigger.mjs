// Smoke test del trigger trg_app_versiones_publicada_unica — marca la version
// mas vieja como publicada y verifica que solo quede 1 fila true, luego
// restaura el estado original.
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function dbq(ref, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

const before = await dbq(env.ref, `select version from sgc.app_versiones where plataforma='movil' and publicada`);
console.log('Antes (publicada=true):', before);

const oldest = await dbq(env.ref, `select version from sgc.app_versiones where plataforma='movil' order by fecha asc limit 1`);
const oldVersion = oldest[0].version;
console.log('Marcando como publicada (debe apagar las demás):', oldVersion);

await dbq(env.ref, `update sgc.app_versiones set publicada = true where plataforma='movil' and version = '${oldVersion}'`);

const after = await dbq(env.ref, `select count(*)::int as n from sgc.app_versiones where plataforma='movil' and publicada`);
console.log('Después, count(publicada=true) debe ser 1:', after);

// Restaurar: apagar la de prueba, re-encender las que estaban antes
await dbq(env.ref, `update sgc.app_versiones set publicada = false where plataforma='movil' and version = '${oldVersion}'`);
for (const row of before) {
  await dbq(env.ref, `update sgc.app_versiones set publicada = true where plataforma='movil' and version = '${row.version}'`);
}
const restored = await dbq(env.ref, `select version from sgc.app_versiones where plataforma='movil' and publicada`);
console.log('Restaurado a:', restored);
