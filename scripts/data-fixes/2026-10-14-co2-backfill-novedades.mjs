// scripts/data-fixes/2026-10-14-co2-backfill-novedades.mjs — PROMPT-98 F7 (CO2)
// Backfill: todos los usuarios EXISTENTES quedan con `novedades_vista_web` /
// `novedades_vista_app` = la versión publicada ACTUAL (no les sale el historial
// completo de golpe); solo los cambios a partir de la próxima versión publicada
// les aparecerán en Novedades.
//
//   node scripts/data-fixes/2026-10-14-co2-backfill-novedades.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-14-co2-backfill-novedades.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-14-co2-backfill-novedades.mjs --env prod --apply --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

// El web nunca marca "publicada" (cada deploy de Vercel YA es la versión actual;
// ese flag es solo del rollout por etapas de la app móvil) — para web, la "actual"
// es simplemente la de mayor número registrada.
const [webActual] = await dbQuery(env, `
  select version from sgc.app_versiones where plataforma='web'
  order by sgc.semver_code(version) desc limit 1`);
const [appActual] = await dbQuery(env, `
  select version from sgc.app_versiones where plataforma='movil' and publicada
  order by sgc.semver_code(version) desc limit 1`);

console.log(`web actual: ${webActual?.version ?? '(ninguna publicada)'}`);
console.log(`app actual: ${appActual?.version ?? '(ninguna publicada)'}`);

const [{ count: sinWeb }] = await dbQuery(env, `
  select count(*) as count from sgc.usuarios u
  left join sgc.usuario_preferencias p on p.usuario_id = u.id
  where p.novedades_vista_web is null`);
const [{ count: sinApp }] = await dbQuery(env, `
  select count(*) as count from sgc.usuarios u
  left join sgc.usuario_preferencias p on p.usuario_id = u.id
  where p.novedades_vista_app is null`);
console.log(`usuarios sin novedades_vista_web: ${sinWeb}`);
console.log(`usuarios sin novedades_vista_app: ${sinApp}`);

if (APPLY) {
  if (webActual?.version) {
    await dbQuery(env, `
      insert into sgc.usuario_preferencias (usuario_id, novedades_vista_web)
      select id, '${webActual.version}' from sgc.usuarios
      on conflict (usuario_id) do update set novedades_vista_web = coalesce(sgc.usuario_preferencias.novedades_vista_web, excluded.novedades_vista_web)`);
  }
  if (appActual?.version) {
    await dbQuery(env, `
      insert into sgc.usuario_preferencias (usuario_id, novedades_vista_app)
      select id, '${appActual.version}' from sgc.usuarios
      on conflict (usuario_id) do update set novedades_vista_app = coalesce(sgc.usuario_preferencias.novedades_vista_app, excluded.novedades_vista_app)`);
  }
  console.log('✅ backfill aplicado.');
} else {
  console.log('(dry-run) usa --apply para ejecutar.');
}
