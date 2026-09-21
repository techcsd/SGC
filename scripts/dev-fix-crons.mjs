// dev-fix-crons.mjs — BU1 F4.1 — red de seguridad: si algún cron del entorno tiene
// el ref de PROD escrito en su command (p. ej. un dev restaurado desde un dump de
// prod), lo reescribe al ref del entorno con cron.alter_job y REPORTA el hallazgo
// (un secreto/ref en SQL versionado es un smell). La solución de raíz es
// sql/2026-09-18-bu1-crons-por-entorno.sql (edge_base_url()); esto es defensa.
//   node scripts/dev-fix-crons.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';

const PROD_REF = 'jeeqhgccqefbqilntcpu';
const env = await resolverEnv(process.argv.slice(2));

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(await res.text());
  return JSON.parse(await res.text());
}

const jobs = await sql(`select jobid, jobname, command from cron.job where command like '%${PROD_REF}%'`);
if (!jobs.length) { console.log(`✓ ${env.entorno}: ningún cron con el ref de prod escrito (nada que corregir).`); process.exit(0); }
if (env.entorno === 'prod') { console.error('🔴 en prod NO se reescribe por aquí — usa la migración de crons.'); process.exit(1); }

console.log(`⚠️ ${jobs.length} cron(s) con el ref de prod en su command → reescribiendo a ${env.ref}:`);
for (const j of jobs) {
  console.log(`   - ${j.jobname} (HALLAZGO: ref de prod embebido en SQL versionado)`);
  const nuevo = j.command.split(PROD_REF).join(env.ref);
  await sql(`select cron.alter_job(${j.jobid}, command := $fix$${nuevo}$fix$)`);
}
const left = await sql(`select count(*)::int n from cron.job where command like '%${PROD_REF}%'`);
console.log(`✓ hecho. Crons con ref de prod restantes: ${left[0].n}`);
