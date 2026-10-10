// scripts/data-fixes/2026-10-08-cl5-movimiento-catalogo.mjs — CL5 (reglas 18/19)
//
// Sube las filas WEB del registro `src/shared/motion/catalogo-movimiento.ts` a
// `sgc.movimiento_catalogo` (upsert por (sistema,id)). Fuente única: lee el registro
// real (Node type-stripping). El hijo (csd-app) sube SUS filas con su propio script.
// Se corre en cada release (ver guía de publicación).
//
//   node scripts/data-fixes/2026-10-08-cl5-movimiento-catalogo.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-08-cl5-movimiento-catalogo.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-cl5-movimiento-catalogo.mjs --env prod --apply    (tras OK)
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

// Lee el registro real (TS) en un subproceso con type-stripping → JSON.
const regPath = resolve('src/shared/motion/catalogo-movimiento.ts').replace(/\\/g, '/');
const out = execFileSync(
  process.execPath,
  ['--experimental-strip-types', '-e',
   `import('file://${regPath}').then(m=>process.stdout.write(JSON.stringify(m.CATALOGO_MOVIMIENTO)))`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
);
const rows = JSON.parse(out).filter((r) => r.sistema === 'web');
console.log(`\n📋 (${env.entorno}) Filas WEB en el registro: ${rows.length}`);
for (const r of rows) console.log(`   · [${r.nivel}] ${r.id} — ${r.nombre}`);

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `array[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',')}]::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const values = rows.map((r) => `(${[
  lit('web'), lit(r.id), lit(r.nombre), lit(r.nivel), lit(r.donde), lit(r.pantallas),
  lit(r.duracionMs), lit(r.curva), lit(r.reducido), lit(r.desdeVersion), lit(r.previewKey), lit(r.estado),
].join(', ')}, now())`).join(',\n  ');

const sql = `
insert into sgc.movimiento_catalogo
  (sistema, id, nombre, nivel, donde, pantallas, duracion_ms, curva, reducido, desde_version, preview_key, estado, actualizado_en)
values
  ${values}
on conflict (sistema, id) do update set
  nombre=excluded.nombre, nivel=excluded.nivel, donde=excluded.donde, pantallas=excluded.pantallas,
  duracion_ms=excluded.duracion_ms, curva=excluded.curva, reducido=excluded.reducido,
  desde_version=excluded.desde_version, preview_key=excluded.preview_key, estado=excluded.estado,
  actualizado_en=now();`;

if (!APPLY) {
  console.log('\n— DRY-RUN — (no se escribió nada). Para aplicar: añade --apply');
  console.log('SQL (primeras líneas):\n' + sql.split('\n').slice(0, 6).join('\n') + '\n   …');
  process.exit(0);
}

console.log('\n▶ Upsert en sgc.movimiento_catalogo…');
await dbQuery(env, sql);
const n = await dbQuery(env, `select count(*) c from sgc.movimiento_catalogo where sistema='web'`);
console.log(`✅ Listo. Filas web en el catálogo: ${n?.[0]?.c}\n`);
