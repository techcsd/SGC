// scripts/data-fixes/2026-10-12-cm6-tope-semanal-50.mjs  (CM6 — regla 18/19/CD10)
//
// Pone el TOPE SEMANAL de incentivos en 50 puntos (indicado por Xavier; decisión de
// Misael/Raykler). Crea una nueva versión de `incentivo_config` vía el RPC canónico
// `incentivo_set_config`, PRESERVANDO pesos/mínimo/factor/topes actuales del entorno.
// Impersona a un admin del entorno (el RPC exige puede_gestionar_incentivos()).
//
// Las semanas ya generadas NO se recalculan (por diseño); aplica a partir de la próxima.
//
//   node scripts/data-fixes/2026-10-12-cm6-tope-semanal-50.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-12-cm6-tope-semanal-50.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-12-cm6-tope-semanal-50.mjs --env prod --apply --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');
const TOPE = 50;

const [cfg] = await dbQuery(env, `
  select minimo_semanal, pesos, ayudante_factor, coalesce(topes,'{}'::jsonb) topes, maximo_semanal, version
  from sgc.incentivo_config where activo order by version desc limit 1`);
if (!cfg) { console.error('🔴 No hay config de incentivos activa.'); process.exit(1); }

const [adm] = await dbQuery(env, `
  select ur.usuario_id uid from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id
  where r.codigo='admin' limit 1`);
if (!adm) { console.error('🔴 No hay admin para impersonar.'); process.exit(1); }

console.log(`\n(${env.entorno}) config activa v${cfg.version}: minimo=${cfg.minimo_semanal} maximo=${cfg.maximo_semanal ?? 'sin tope'} factor=${cfg.ayudante_factor}`);
console.log(`→ nueva versión con maximo_semanal=${TOPE} (pesos/minimo/factor/topes preservados). admin=${adm.uid}`);

if (!APPLY) { console.log('\n(dry-run) usa --apply para crear la versión.'); process.exit(0); }

const pesos = JSON.stringify(cfg.pesos).replace(/'/g, "''");
const topes = JSON.stringify(cfg.topes).replace(/'/g, "''");
const claims = JSON.stringify({ sub: adm.uid, role: 'authenticated' }).replace(/'/g, "''");
await dbQuery(env, `
  select set_config('request.jwt.claims', '${claims}', true);
  select sgc.incentivo_set_config(${Number(cfg.minimo_semanal)}, '${pesos}'::jsonb, ${Number(cfg.ayudante_factor)},
    'Tope semanal ${TOPE} (indicado por Xavier · Misael/Raykler)', ${TOPE}, '${topes}'::jsonb);`);

const [nv] = await dbQuery(env, `select version, maximo_semanal from sgc.incentivo_config where activo order by version desc limit 1`);
console.log(`\n✅ (${env.entorno}) nueva config activa v${nv.version} · maximo_semanal=${nv.maximo_semanal}`);
