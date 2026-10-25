// CY18 — motor de comparacion SGC <-> Odoo (solo lectura, no escribe nada).
// Lee sgc-snapshot-<env>.json (scripts/diagnosticos/2026-10-25-cy18-snapshot-sgc.mjs)
// y los CSV de herramientas/odoo-lectura.mjs, y produce una matriz de 6 clases:
//   equivalente_confirmado | solo_sgc | solo_odoo | diferencias | ambiguo_duplicado | archivado_no_aplica
// Uso: node scripts/diagnosticos/2026-10-25-cy18-comparar.mjs <carpeta-export> <env: dev|prod>
import fs from 'node:fs';

const [dir, envArg = 'prod'] = process.argv.slice(2);
if (!dir) { console.error('Uso: node 2026-10-25-cy18-comparar.mjs <carpeta-export> [dev|prod]'); process.exit(1); }

function csv(nombre) {
  const texto = fs.readFileSync(`${dir}/${nombre}`, 'utf8').replace(/^﻿/, '');
  const lineas = texto.split(/\r?\n/).filter((l) => l.length > 0);
  const cab = parseLinea(lineas[0]);
  return lineas.slice(1).map((l) => {
    const campos = parseLinea(l);
    const o = {};
    cab.forEach((c, i) => (o[c] = campos[i] ?? ''));
    return o;
  });
}
function parseLinea(linea) {
  const out = [];
  let cur = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (enComillas) {
      if (ch === '"' && linea[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') enComillas = false;
      else cur += ch;
    } else {
      if (ch === '"') enComillas = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
const norm = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim().replace(/\s+/g, ' ');
const soloDigitos = (s) => (s ?? '').toString().replace(/\D/g, '');

const snapshot = JSON.parse(fs.readFileSync(`${dir}/sgc-snapshot-${envArg}.json`, 'utf8'));
const resumen = JSON.parse(fs.readFileSync(`${dir}/RESUMEN.json`, 'utf8'));

const odooPartners = csv('res_partner.csv');
const odooProductos = csv('product_template.csv');
const odooCategorias = csv('product_category.csv');
const odooUoM = csv('uom_uom.csv');
const odooBodegas = csv('stock_warehouse.csv');

const filas = []; // matriz final
const push = (f) => filas.push(f);

// ---------- PROVEEDORES ----------
const partnersPorVat = new Map();
const partnersPorNombre = new Map();
for (const p of odooPartners) {
  const vat = soloDigitos(p.vat);
  if (vat) partnersPorVat.set(vat, p);
  const n = norm(p.name);
  if (n) { if (!partnersPorNombre.has(n)) partnersPorNombre.set(n, []); partnersPorNombre.get(n).push(p); }
}
const vatUsados = new Set();
for (const prov of snapshot.proveedores) {
  const vatSgc = soloDigitos(prov.rnc);
  const odooRefNum = prov.odoo_ref && /^\d+$/.test(prov.odoo_ref) ? prov.odoo_ref : null;
  let match = null, estado, evidencia, diferencia = '';
  if (odooRefNum) {
    match = odooPartners.find((p) => p.id === odooRefNum);
    if (match) { estado = 'equivalente_confirmado'; evidencia = `odoo_ref=${odooRefNum} existe en res.partner`; vatUsados.add(soloDigitos(match.vat)); }
    else { estado = 'diferencias'; evidencia = `odoo_ref=${odooRefNum} NO existe en la exportacion actual de Odoo`; diferencia = 'odoo_ref apunta a un registro inexistente/archivado'; }
  } else if (vatSgc && partnersPorVat.has(vatSgc)) {
    match = partnersPorVat.get(vatSgc);
    estado = 'equivalente_confirmado';
    evidencia = `RNC/cedula coincide exacto (${vatSgc})`;
    vatUsados.add(vatSgc);
  } else {
    const candidatos = partnersPorNombre.get(norm(prov.nombre)) || [];
    if (candidatos.length === 1) { match = candidatos[0]; estado = 'ambiguo_duplicado'; evidencia = `nombre coincide ("${prov.nombre}") pero sin RNC/odoo_ref -- NO confirma identidad`; diferencia = vatSgc ? `SGC tiene RNC ${vatSgc}, Odoo vat="${match.vat||'(vacio)'}"` : 'SGC sin RNC capturado'; }
    else if (candidatos.length > 1) { estado = 'ambiguo_duplicado'; evidencia = `${candidatos.length} partners de Odoo con el mismo nombre normalizado -- requiere desambiguar a mano`; }
    else { estado = 'solo_sgc'; evidencia = 'sin candidato por RNC ni nombre en la exportacion de Odoo'; }
  }
  push({
    entidad: 'proveedor', id_sgc: prov.id, instancia: 'odoo-prod', modelo: 'res.partner',
    id_odoo: match?.id ?? '', clave_negocio: `${prov.nombre} | RNC:${vatSgc || '(vacio)'}`,
    estado, diferencia, evidencia, accion_propuesta: estado === 'equivalente_confirmado' ? 'vincular odoo_ref si falta' : (estado === 'ambiguo_duplicado' ? 'responsable decide: confirmar o tratar como distinto' : 'alta pendiente en el lado que falte'),
  });
}
for (const p of odooPartners) {
  if (Number(p.supplier_rank) > 0 && !vatUsados.has(soloDigitos(p.vat)) && !snapshot.proveedores.some((s) => s.odoo_ref === p.id)) {
    const n = norm(p.name);
    const yaListado = filas.some((f) => f.entidad === 'proveedor' && f.id_odoo === p.id);
    if (!yaListado) {
      push({ entidad: 'proveedor', id_sgc: '', instancia: 'odoo-prod', modelo: 'res.partner', id_odoo: p.id,
        clave_negocio: `${p.name} | vat:${p.vat || '(vacio)'}`, estado: p.active === 'false' ? 'archivado_no_aplica' : 'solo_odoo',
        diferencia: '', evidencia: `supplier_rank=${p.supplier_rank}, sin equivalente SGC detectado`, accion_propuesta: 'evaluar alta en SGC si se usara como proveedor' });
    }
  }
}

// ---------- ARTICULOS ----------
const prodPorCodigo = new Map();
for (const p of odooProductos) if (p.default_code) prodPorCodigo.set(norm(p.default_code), p);
const prodPorId = new Map(odooProductos.map((p) => [p.id, p]));
const codigosUsados = new Set();
for (const art of snapshot.articulos) {
  const odooRefNum = art.odoo_ref && /^\d+$/.test(art.odoo_ref) ? art.odoo_ref : null;
  let match = null, estado, evidencia, diferencia = '';
  if (odooRefNum) {
    match = prodPorId.get(odooRefNum);
    if (match) { estado = 'equivalente_confirmado'; evidencia = `odoo_ref=${odooRefNum} existe en product.template`; if (match.default_code) codigosUsados.add(norm(match.default_code)); }
    else { estado = 'diferencias'; evidencia = `odoo_ref=${odooRefNum} NO existe (archivado o borrado en Odoo)`; diferencia = 'referencia huerfana'; }
  } else if (art.codigo && prodPorCodigo.has(norm(art.codigo))) {
    match = prodPorCodigo.get(norm(art.codigo));
    estado = 'ambiguo_duplicado';
    evidencia = `codigo SGC "${art.codigo}" coincide con default_code de Odoo -- candidato fuerte, falta confirmar antes de vincular`;
    codigosUsados.add(norm(art.codigo));
  } else {
    estado = 'solo_sgc';
    evidencia = 'sin candidato por codigo en Odoo (nombre no se usa para decidir)';
  }
  push({ entidad: 'articulo', id_sgc: art.id, instancia: 'odoo-prod', modelo: 'product.template',
    id_odoo: match?.id ?? '', clave_negocio: `${art.codigo || '(sin codigo)'} | ${art.nombre}`,
    estado, diferencia, evidencia,
    accion_propuesta: estado === 'equivalente_confirmado' ? 'vincular odoo_ref si falta' : (estado === 'ambiguo_duplicado' ? 'Compras confirma y vincula' : 'evaluar alta en Odoo al homologar (#19)') });
}
let solo_odoo_articulos = 0, archivados_articulos = 0;
for (const p of odooProductos) {
  const cod = p.default_code ? norm(p.default_code) : null;
  const yaMatched = snapshot.articulos.some((a) => a.odoo_ref === p.id) || (cod && codigosUsados.has(cod));
  if (!yaMatched) { if (p.active === 'false') archivados_articulos++; else solo_odoo_articulos++; }
}

// ---------- CATEGORIAS (resumen, sin forzar 1:1) ----------
const catsPorNombre = new Map(odooCategorias.map((c) => [norm(c.name), c]));
let cat_candidatos = 0, cat_solo_sgc = 0;
for (const c of snapshot.categorias) {
  if (catsPorNombre.has(norm(c.nombre))) cat_candidatos++; else cat_solo_sgc++;
}

// ---------- UNIDADES (resumen) ----------
const uomPorNombre = new Map(odooUoM.map((u) => [norm(u.name), u]));
let uom_candidatos = 0, uom_solo_sgc = 0;
for (const u of snapshot.unidades) {
  if (uomPorNombre.has(norm(u.nombre)) || uomPorNombre.has(norm(u.codigo))) uom_candidatos++; else uom_solo_sgc++;
}

// ---------- BODEGAS (resumen -- NO se asume 1:1) ----------
const whPorNombre = new Map(odooBodegas.map((w) => [norm(w.name), w]));
let bod_candidatos = 0, bod_solo_sgc = 0;
for (const b of snapshot.bodegas) {
  if (whPorNombre.has(norm(b.nombre))) bod_candidatos++; else bod_solo_sgc++;
}

// ---------- salida ----------
const porEstado = {};
for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] || 0) + 1;

const cab = ['entidad', 'id_sgc', 'instancia', 'modelo', 'id_odoo', 'clave_negocio', 'estado', 'diferencia', 'evidencia', 'accion_propuesta'];
const csvOut = [cab.join(',')]
  .concat(filas.map((f) => cab.map((k) => `"${(f[k] ?? '').toString().replace(/"/g, '""')}"`).join(',')))
  .join('\n');
fs.writeFileSync(`${dir}/cy18-matriz-${envArg}.csv`, csvOut, 'utf8');

const resumenSalida = {
  generado_en: new Date().toISOString(),
  entorno_sgc: envArg,
  odoo_version: resumen.version,
  odoo_compania: resumen.companias?.[0]?.nombre,
  totales_matriz_detallada: { proveedores: snapshot.proveedores.length + odooPartners.filter((p) => Number(p.supplier_rank) > 0).length, articulos_sgc: snapshot.articulos.length, por_estado: porEstado },
  articulos_solo_odoo_sin_detalle: solo_odoo_articulos,
  articulos_archivados_odoo: archivados_articulos,
  categorias: { sgc: snapshot.categorias.length, odoo: odooCategorias.length, candidatos_por_nombre: cat_candidatos, solo_sgc_sin_candidato: cat_solo_sgc },
  unidades: { sgc: snapshot.unidades.length, odoo: odooUoM.length, candidatos_por_nombre: uom_candidatos, solo_sgc_sin_candidato: uom_solo_sgc },
  bodegas: { sgc: snapshot.bodegas.length, odoo_warehouses: odooBodegas.length, candidatos_por_nombre: bod_candidatos, solo_sgc_sin_candidato: bod_solo_sgc, nota: 'NO se asume 1:1 bodega<->warehouse; candidato = coincidencia de nombre solamente, pendiente de revision humana' },
  proyectos: { sgc: snapshot.proyectos.length, nota: 'sin modulo de proyectos/analitica exportado de Odoo esta pasada -- fuera de alcance de esta comparacion, abierto' },
  conciliacion: {
    sgc_total_proveedores: snapshot.conteos[0].proveedores,
    filas_proveedor_en_matriz: filas.filter((f) => f.entidad === 'proveedor').length,
    sgc_total_articulos: snapshot.conteos[0].articulos,
    filas_articulo_en_matriz: filas.filter((f) => f.entidad === 'articulo').length + solo_odoo_articulos + archivados_articulos,
  },
};
fs.writeFileSync(`${dir}/cy18-resumen-${envArg}.json`, JSON.stringify(resumenSalida, null, 1), 'utf8');
console.log(JSON.stringify(resumenSalida, null, 1));
console.log(`\nMatriz completa: ${dir}/cy18-matriz-${envArg}.csv (${filas.length} filas detalladas)`);
