// Diagnóstico de solo lectura — estado de sgc.app_versiones antes de aplicar
// el hotfix DJ (publicar 2.66.2 + trigger publicada-única).
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

const rows = await dbq(env.ref, `select version, publicada, minima, fecha from sgc.app_versiones where plataforma='movil' order by fecha desc limit 10`);
console.log(`\n== ${env.entorno} (${env.ref}) — últimas 10 filas móvil ==`);
console.table(rows);

const allPublicadas = await dbq(env.ref, `select version, fecha from sgc.app_versiones where plataforma='movil' and publicada order by fecha desc`);
console.log(`== TODAS las filas publicada=true (móvil), sin límite ==`);
console.table(allPublicadas);

const trig = await dbq(env.ref, `select tgname from pg_trigger where tgname='trg_app_versiones_publicada_unica'`);
console.log(`Trigger ya existe: ${Array.isArray(trig) && trig.length > 0}`);
