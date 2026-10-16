// scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs — CP5 (docs/STAGING.md)
// Refresco MENSUAL del catálogo de dev (ANONIMIZADO) leyendo de prod: bodegas,
// artículos, proyectos/obras, vehículos. NO toca personas/usuarios, documentos
// ni fotos — eso lo cubre `seed-dev.mjs` (que sí anonimiza usuarios completos).
//
// Por qué existe además de seed-dev.mjs: seed-dev.mjs reconstruye TODO el
// esquema (operación + usuarios) y es pesado; este script es el refresco
// liviano y frecuente de solo las 4 tablas de catálogo, para que dev no se
// quede con artículos/obras/vehículos viejos entre corridas completas de
// seed-dev. Por decisión de Xaviel corre mensual por defecto (sí, correrlo).
//
// Qué se excluye explícitamente (nunca se copia de estas 4 tablas):
//   - FKs/nombres/teléfonos de PERSONAS: responsable_id, responsable_nombre,
//     encargado_id, cerrado_por, ingeniero_obra(_id), maestro_encargado,
//     maestro_usuario_id, maestro_personal_id, contacto_nombre, contacto_telefono,
//     km_base_combustible_por → siempre NULL en dev.
//   - FOTOS/imágenes: fotos, foto_portada, imagen_url → siempre NULL/'{}'.
//   - importacion_id (provenance de un lote de import de PROD, no tiene sentido
//     fuera de su propio import) → siempre NULL.
//   - Filas con es_prueba = true en prod (son QA/demo de prod, no catálogo real).
//
// CLI:
//   node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env prod            (DRY-RUN, lee prod, solo lectura)
//   node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env dev             (DRY-RUN, igual, más conteo actual de dev)
//   node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env dev --apply     (ESCRIBE en dev — el único destino válido)
//   node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env prod --apply    → RECHAZADO (prod nunca es destino de escritura aquí)
//
// --apply SOLO corre con --env dev (el destino de escritura siempre es dev; prod
// se lee, nunca se escribe, desde este script). Lectura de prod vía Management API
// con SUPABASE_ACCESS_TOKEN (igual que scripts/diagnosticos/*): solo SELECT.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');

const env = await resolverEnv(argv); // exige --env dev|prod; confirma banner si prod

if (APPLY && env.entorno !== 'dev') {
  console.error('🔴 --apply solo corre con --env dev (el destino de escritura siempre es dev; prod es solo lectura en este script).');
  console.error('   Uso: node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env dev --apply');
  process.exit(1);
}

// Prod SIEMPRE se lee (sea cual sea el --env pedido) — reusamos resolverEnv para
// no hardcodear el ref de prod (guard verify-sin-ref-hardcodeado solo permite el
// literal dentro de scripts/lib/entorno.mjs).
const prod = env.entorno === 'prod' ? env : await resolverEnv(['--env', 'prod', ...(YES ? ['--yes'] : [])]);
// Dev se resuelve siempre (no pide confirmación) — para comparar conteos en dry-run
// y como destino real cuando --apply.
const dev = env.entorno === 'dev' ? env : await resolverEnv(['--env', 'dev']);

// ── Tablas en el orden en que deben insertarse (FK: bodegas → proyectos) ────────
const TABLAS = [
  {
    tabla: 'proyectos',
    anonimizar: (row) => ({
      ...row,
      responsable_id: null,
      responsable_nombre: null,
      cerrado_por: null,
      ingeniero_obra: null,
      ingeniero_obra_id: null,
      maestro_encargado: null,
      maestro_usuario_id: null,
      maestro_personal_id: null,
      contacto_nombre: null,
      contacto_telefono: null,
    }),
  },
  {
    tabla: 'bodegas',
    anonimizar: (row) => ({ ...row, encargado_id: null }),
  },
  {
    tabla: 'articulos',
    anonimizar: (row) => ({ ...row, imagen_url: null, importacion_id: null }),
  },
  {
    tabla: 'vehiculos',
    anonimizar: (row) => ({
      ...row,
      responsable_id: null,
      km_base_combustible_por: null,
      foto_portada: null,
      fotos: [],
      importacion_id: null,
    }),
  },
];

// ── Metadatos de columnas (tipos) — se leen de prod para construir SQL tipado ───
async function columnasDe(tabla) {
  const cols = await dbQuery(prod, `
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'sgc' and table_name = '${tabla}'
    order by ordinal_position`);
  if (!Array.isArray(cols) || !cols.length) throw new Error(`No se encontraron columnas para sgc.${tabla} (¿existe la tabla?)`);
  return cols;
}

function sqlLiteral(value, dataType) {
  if (value === null || value === undefined) return 'NULL';
  if (dataType === 'ARRAY') {
    const arr = Array.isArray(value) ? value : [value];
    if (!arr.length) return "'{}'";
    const esc = arr.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    return `'{${esc}}'`;
  }
  if (dataType === 'boolean') return value ? 'true' : 'false';
  if (['integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real'].includes(dataType)) {
    return Number.isFinite(Number(value)) ? String(value) : 'NULL';
  }
  if (dataType === 'uuid') return `'${String(value).replace(/'/g, "''")}'::uuid`;
  // text/varchar/date/timestamp/json/etc → literal entre comillas (las fechas ISO
  // de PostgREST/Management API se aceptan tal cual por Postgres).
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function copiarTabla({ tabla, anonimizar }) {
  const cols = await columnasDe(tabla);
  const nombresCols = cols.map((c) => c.column_name);

  const filasProd = await dbQuery(prod, `select * from sgc.${tabla} where coalesce(es_prueba, false) = false`);
  const rows = Array.isArray(filasProd) ? filasProd : [];

  const [{ count: enDevAntes }] = await dbQuery(dev, `select count(*)::int as count from sgc.${tabla}`);

  console.log(`\n── sgc.${tabla} ──`);
  console.log(`  en prod (es_prueba=false): ${rows.length}`);
  console.log(`  en dev ahora mismo:        ${enDevAntes}`);

  if (!rows.length) { console.log('  (nada que copiar)'); return { tabla, prod: 0, devAntes: enDevAntes, upserted: 0 }; }

  if (!APPLY) {
    console.log(`  (dry-run) se upsertarían ${rows.length} fila(s) por id — usa --env dev --apply para ejecutar.`);
    return { tabla, prod: rows.length, devAntes: enDevAntes, upserted: 0 };
  }

  const anon = rows.map((r) => anonimizar(r));
  const setClause = nombresCols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');

  const LOTE = 200;
  let upserted = 0;
  for (let i = 0; i < anon.length; i += LOTE) {
    const lote = anon.slice(i, i + LOTE);
    const valores = lote.map((row) => `(${cols.map((c) => sqlLiteral(row[c.column_name], c.data_type)).join(', ')})`).join(',\n    ');
    const sql = `
      insert into sgc.${tabla} (${nombresCols.join(', ')})
      values
        ${valores}
      on conflict (id) do update set ${setClause}`;
    await dbQuery(dev, sql);
    upserted += lote.length;
  }
  console.log(`  ✅ upsertadas ${upserted} fila(s) en dev.`);
  return { tabla, prod: rows.length, devAntes: enDevAntes, upserted };
}

console.log(`▶ CP5 — catálogo anonimizado prod → dev  ${APPLY ? '(APLICANDO a dev)' : '(DRY-RUN, solo lectura)'}\n`);
console.log(`  fuente (lectura):  prod (${prod.ref})`);
console.log(`  destino (escritura${APPLY ? '' : ', si --apply'}): dev (${dev.ref})`);

const resumen = [];
for (const t of TABLAS) resumen.push(await copiarTabla(t));

console.log('\n── Resumen ──');
for (const r of resumen) {
  console.log(`  ${r.tabla.padEnd(12)} prod=${String(r.prod).padStart(4)}  dev-antes=${String(r.devAntes).padStart(4)}  ${APPLY ? `upsertadas=${r.upserted}` : '(dry-run, nada escrito)'}`);
}
if (!APPLY) {
  console.log('\n(dry-run) nada se escribió. Para aplicar: node scripts/data-fixes/2026-10-16-cp5-catalogo-a-dev.mjs --env dev --apply');
}
