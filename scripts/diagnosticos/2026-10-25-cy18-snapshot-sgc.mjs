// CY18 — snapshot SOLO LECTURA del lado SGC para el diagnostico de desfases con Odoo.
// Uso: node scripts/diagnosticos/2026-10-25-cy18-snapshot-sgc.mjs --env dev
// No escribe nada. Vuelca a JSON (fuera del repo) para que el motor de comparacion lo lea.
import '../lib/load-env.mjs';
import fs from 'node:fs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const outDir = 'C:/developer/improvements/octubre 2026/imp 25102026/odoo-export';
fs.mkdirSync(outDir, { recursive: true });

async function tabla(nombre, sql) {
  const filas = await dbQuery(env, sql);
  console.error(`  ${nombre}: ${Array.isArray(filas) ? filas.length : '?'} filas`);
  return filas;
}

const snapshot = {
  extraido_en: new Date().toISOString(),
  entorno: env.entorno,
  ref: env.ref,
};

snapshot.proveedores = await tabla('proveedores', `
  select id, nombre, rnc, telefono, email, activo, odoo_ref
  from sgc.proveedores order by nombre`);

snapshot.articulos = await tabla('articulos', `
  select id, codigo, nombre, categoria_id, unidad, unidad_paquete, factor_paquete,
         activo, es_prueba, odoo_ref, subgrupo
  from sgc.articulos order by nombre`);

snapshot.categorias = await tabla('categorias_inventario', `
  select id, nombre, padre_id, activo from sgc.categorias_inventario order by id`);

snapshot.unidades = await tabla('unidades', `
  select * from sgc.unidades order by 1`);

snapshot.bodegas = await tabla('bodegas', `
  select id, nombre, proyecto_id, es_central, es_principal, es_principal_obra, activo
  from sgc.bodegas order by nombre`);

snapshot.proyectos = await tabla('proyectos', `
  select id, nombre, estado, activo from sgc.proyectos order by nombre`);

snapshot.ordenes_compra = await tabla('ordenes_compra', `
  select oc.id, oc.numero, oc.proveedor_id, oc.estado, oc.proyecto_id, oc.es_prueba
  from sgc.ordenes_compra oc order by oc.numero`);

snapshot.conteos = await tabla('conteos', `
  select
    (select count(*) from sgc.proveedores) as proveedores,
    (select count(*) from sgc.proveedores where activo) as proveedores_activos,
    (select count(*) from sgc.articulos) as articulos,
    (select count(*) from sgc.articulos where activo and not coalesce(es_prueba,false)) as articulos_activos_reales,
    (select count(*) from sgc.categorias_inventario) as categorias,
    (select count(*) from sgc.unidades) as unidades,
    (select count(*) from sgc.bodegas) as bodegas,
    (select count(*) from sgc.proyectos) as proyectos,
    (select count(*) from sgc.articulos where odoo_ref is not null) as articulos_con_odoo_ref,
    (select count(*) from sgc.proveedores where odoo_ref is not null) as proveedores_con_odoo_ref,
    (select count(*) from sgc.ordenes_compra) as ordenes_compra
`);

const outPath = `${outDir}/sgc-snapshot-${env.entorno}.json`;
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 1), 'utf8');
console.error(`\nGuardado: ${outPath}`);
