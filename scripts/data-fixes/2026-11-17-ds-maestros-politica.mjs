// 2026-11-17 -- Habilita la politica de publicacion de los MAESTROS (articulo, categoria, unidad, proveedor): el worker verifica el vinculo
// contra Odoo (sin simulador). Autorizado por Xaviel (17-nov: "todo debe quedar sincronizado"). Apagar: --apagar.
//   node scripts/data-fixes/2026-11-17-ds-maestros-politica.mjs --env dev|prod [--yes] [--apagar]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
const on = !argv.includes('--apagar');
await consulta(env, `insert into sgc.odoo_publicacion_politica (agregado_tipo, habilitada, notas) select t, ${on}, 'Maestros: verificacion de vinculo contra Odoo (17-nov)' from unnest(array['articulo','categoria_inventario','unidad','proveedor']) t on conflict (agregado_tipo) do update set habilitada=${on}, actualizada_en=now()`);
console.log(JSON.stringify(await consulta(env, `select agregado_tipo, habilitada from sgc.odoo_publicacion_politica order by 1`)));
