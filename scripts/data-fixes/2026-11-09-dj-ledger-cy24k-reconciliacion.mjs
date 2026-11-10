// scripts/data-fixes/2026-11-09-dj-ledger-cy24k-reconciliacion.mjs
// sql/2026-10-30-cy24k-oc-lee-odoo-directo.sql fue reescrito el 2026-11-01
// (commit f96dd259, Alejandro Miranda) con la nota "reescrita (sin aplicar);
// smokes actualizados (sin correr)" -- pero su efecto completo YA está en
// dev: las 5 columnas espejo de ordenes_compra están eliminadas, las 6
// funciones nuevas existen (vincular_oc_odoo, oc_comando_finalizar,
// oc_comando_registrar_inicio, oc_para_publicar, oc_para_comando,
// mi_solicitud_compra_odoo_estado), registrar_publicacion_oc no existe, y el
// check de odoo_comandos_oc.estado ya excluye 'incierto'. Verificado por
// objeto contra información_schema/pg_proc/pg_constraint -- no se ejecuta
// ningún DDL aquí, solo se concilia el ledger con lo que la base ya refleja.
// Re-correr el .sql tal cual fallaría de entrada (el preflight lee una
// columna que ya no existe).
//
// Aprobado por Xaviel 2026-11-09 para destrabar el gate de release-check
// antes del PR dev -> main de la ronda DJ (fix no relacionado, pestaña
// Estado de WhatsApp).
//
//   node scripts/data-fixes/2026-11-09-dj-ledger-cy24k-reconciliacion.mjs --env dev
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const archivo = 'sql/2026-10-30-cy24k-oc-lee-odoo-directo.sql';
const checksum = createHash('sha256')
  .update(readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

const columnas = await dbQuery(
  env,
  `select column_name from information_schema.columns
   where table_schema = 'sgc' and table_name = 'ordenes_compra'
     and column_name in ('odoo_sync_estado', 'odoo_state', 'odoo_nombre', 'odoo_total', 'odoo_sync_error')`
);
if (columnas.length > 0) {
  console.error(`🔴 Las columnas espejo todavía existen (${columnas.map((c) => c.column_name).join(', ')}) -- la migración NO está aplicada de verdad. Aborto.`);
  process.exit(1);
}

const funciones = await dbQuery(
  env,
  `select proname from pg_proc where pronamespace = 'sgc'::regnamespace
     and proname in ('vincular_oc_odoo','oc_comando_finalizar','oc_comando_registrar_inicio','oc_para_publicar','oc_para_comando','mi_solicitud_compra_odoo_estado')`
);
const esperadas = ['vincular_oc_odoo', 'oc_comando_finalizar', 'oc_comando_registrar_inicio', 'oc_para_publicar', 'oc_para_comando', 'mi_solicitud_compra_odoo_estado'];
const faltantes = esperadas.filter((f) => !funciones.some((r) => r.proname === f));
if (faltantes.length > 0) {
  console.error(`🔴 Faltan funciones (${faltantes.join(', ')}) -- la migración NO está aplicada de verdad. Aborto.`);
  process.exit(1);
}

const checkEstado = await dbQuery(
  env,
  `select pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = 'sgc.odoo_comandos_oc'::regclass and conname = 'odoo_comandos_oc_estado_check'`
);
if (!checkEstado[0] || checkEstado[0].def.includes('incierto')) {
  console.error(`🔴 El check de odoo_comandos_oc.estado todavía permite 'incierto' -- la migración NO está aplicada de verdad. Aborto.`);
  process.exit(1);
}

console.log('✅ Verificado por objeto: columnas eliminadas, funciones presentes, check actualizado. Registrando en el ledger (no se ejecuta DDL).');

await dbQuery(
  env,
  `insert into sgc.migraciones_aplicadas (archivo, checksum, entorno, aplicada_por, forzada, motivo)
   values ('${archivo}', '${checksum}', '${env.entorno}', 'claude-code', true,
     'reconciliacion: efecto ya verificado por objeto en la base (ver script), el commit f96dd259 quedo sin registrar en el ledger pese a estar aplicado')
   on conflict (archivo) do update set checksum = excluded.checksum, entorno = excluded.entorno,
     aplicada_en = now(), aplicada_por = excluded.aplicada_por, forzada = excluded.forzada, motivo = excluded.motivo`
);

console.log(`  ↳ registrado: ${archivo} (${checksum.slice(0, 12)}…) en ${env.entorno}`);
