// 2026-11-16 -- ENCIENDE la integracion SGC <-> Odoo en DEV (apuntando al STAGING de Odoo). Solo dev; nunca prod ni el Odoo real.
// Enciende: odoo_instancias.permitir_entrada/salida (instancia de staging), odoo_publicacion_politica de los 6 tipos de documento
// (salida, entrada, retiro, conduce externo, conteo, ajuste por faltante) y las fases canary + expansion. NO enciende 'corte'.
// El canary se configura con el par Bodega Central -> Torre Alpha, 4 articulos homologados con mas existencias en Odoo y el usuario QA admin.
// Los ids se resuelven en vivo; ninguno se copia al repo.  Dry-run por defecto.
//   node scripts/data-fixes/2026-11-16-ds-encender-dev.mjs --env dev [--apply | --apagar]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev. Prod: ver docs/ODOO-PASO-A-PROD.md (requiere OK explicito).'); process.exit(1); }
const apply = argv.includes('--apply'); const apagar = argv.includes('--apagar');
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const TIPOS = ['salida_inventario', 'entrada_inventario', 'retiro_material', 'conduce_externo', 'conteo_inventario', 'ajuste_faltante'];

const [ins] = await sql(`select id from sgc.odoo_instancias where habilitada and entorno='dev' and nombre ilike '%staging%'`);
if (!ins) throw new Error('No hay instancia de staging habilitada en dev (correr 2026-11-16-ds-homologacion-dev.mjs).');

if (apagar) {
  console.log('APAGANDO (dry-run si no hay --apply)');
  if (apply) await sql(`update sgc.odoo_publicacion_politica set habilitada=false where agregado_tipo = any(${lit(`{${TIPOS.join(',')}}`)}::text[]);
    update sgc.odoo_fases set habilitada=false where clave in ('canary','expansion','corte');
    update sgc.odoo_instancias set permitir_entrada=false, permitir_salida=false where id=${lit(ins.id)}`);
  process.exit(0);
}

const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre ilike 'QA admin' limit 1`);
if (!admin) throw new Error('Falta el usuario QA admin en dev.');
const [central] = await sql(`select id, odoo_location_id as loc from sgc.bodegas where codigo_odoo='WH'`);
const vinc = await sql(`select a.id, a.odoo_product_id as p from sgc.articulos a join sgc.stock_por_bodega s on s.articulo_id=a.id where s.bodega_id=${lit(central.id)} and a.odoo_product_id is not null and s.cantidad >= 50`);
const { kw } = await conectar();
const quants = await kw('stock.quant', 'search_read', [[['location_id', '=', Number(central.loc)], ['product_id', 'in', vinc.map((v) => v.p)], ['quantity', '>=', 30]]], { fields: ['product_id', 'quantity'] });
const porProd = new Map(); for (const q of quants) porProd.set(q.product_id[0], (porProd.get(q.product_id[0]) ?? 0) + q.quantity);
const piloto = vinc.filter((v) => porProd.has(v.p)).sort((a, b) => porProd.get(b.p) - porProd.get(a.p)).slice(0, 4).map((v) => v.id);
if (piloto.length < 2) throw new Error('No hay articulos homologados con existencias en Odoo para el piloto.');
console.log(`instancia staging: permitir_entrada/salida=true; politica de ${TIPOS.length} tipos; canary (par WH->TA, ${piloto.length} articulos, 1 usuario) + expansion`);
if (!apply) { console.log('dry-run (usa --apply)'); process.exit(0); }

const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
const cfg = JSON.stringify({ par: { origen: 'WH', destino: 'TA' }, articulos_piloto: piloto, usuarios_piloto: [admin.id] });
await sql(`
  select set_config('request.jwt.claims', ${lit(claims)}, true);
  update sgc.odoo_instancias set permitir_entrada=true, permitir_salida=true where id=${lit(ins.id)};
  insert into sgc.odoo_ratificaciones (adr, ratificada_por, nota) select x, ${lit(admin.id)}, 'Ratificacion de prueba en DEV (E2E contra staging); la de prod la firma un admin' from unnest(array[4,5,10,11,15]) x on conflict do nothing;
  insert into sgc.odoo_publicacion_politica (agregado_tipo, habilitada, notas, actualizada_por)
    select t, true, 'Encendido en dev para E2E contra staging', ${lit(admin.id)} from unnest(${lit(`{${TIPOS.join(',')}}`)}::text[]) t
    on conflict (agregado_tipo) do update set habilitada=true, actualizada_en=now();
  select sgc.odoo_fase_set('canary', true, ${lit(cfg)}::jsonb);
  select sgc.odoo_fase_set('expansion', true);`);
console.log(JSON.stringify(await sql(`select clave, habilitada from sgc.odoo_fases order by clave`)));
console.log(JSON.stringify(await sql(`select agregado_tipo, habilitada from sgc.odoo_publicacion_politica order by 1`)));
