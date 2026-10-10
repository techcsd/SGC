// scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs — CL3 (reglas 18/19)
//
// Marca a TODOS los usuarios existentes como "ya vieron la bienvenida" (web y app),
// para que SOLO los usuarios NUEVOS la vean. Aditivo e idempotente (solo rellena los
// flags vacíos). Requiere la migración sql/2026-10-08-cl3-bienvenida.sql aplicada.
//
//   node scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs --env prod --apply    (tras OK)
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

// Cuántos usuarios no tienen aún marcada la bienvenida web.
const pend = await dbQuery(env, `
  select count(*) c from sgc.usuarios u
  where u.activo and not exists (
    select 1 from sgc.usuario_preferencias p
    where p.usuario_id = u.id and p.bienvenida_web_v1_vista is not null)`);
const n = pend?.[0]?.c ?? '?';
console.log(`\n👋 (${env.entorno}) Usuarios activos sin bienvenida web marcada: ${n}`);

// Inserta prefs faltantes + marca ambos flags (solo donde están vacíos).
const sql = `
  insert into sgc.usuario_preferencias (usuario_id, bienvenida_web_v1_vista, bienvenida_app_v2_vista)
  select u.id, now(), now() from sgc.usuarios u
  on conflict (usuario_id) do update set
    bienvenida_web_v1_vista = coalesce(sgc.usuario_preferencias.bienvenida_web_v1_vista, now()),
    bienvenida_app_v2_vista = coalesce(sgc.usuario_preferencias.bienvenida_app_v2_vista, now());`;

if (!APPLY) {
  console.log('\n— DRY-RUN — (no se escribió nada). Para aplicar: añade --apply');
  console.log('SQL:\n' + sql + '\n');
  process.exit(0);
}

console.log('\n▶ Marcando usuarios existentes como vistos…');
await dbQuery(env, sql);
const after = await dbQuery(env, `select count(*) c from sgc.usuario_preferencias where bienvenida_web_v1_vista is not null`);
console.log(`✅ Listo. Con bienvenida web marcada: ${after?.[0]?.c}\n`);
