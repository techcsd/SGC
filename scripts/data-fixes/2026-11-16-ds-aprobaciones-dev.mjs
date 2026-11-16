// 2026-11-16 DS-07/DS-06 -- aplica en DEV las decisiones humanas de Xaviel: propuestas de catalogo seguras aprobadas y
// cuentas analiticas confirmadas. Las propuestas dudosas (dimension/marca/propiedad distinta) NO se deciden: quedan pendientes.
// Dry-run por defecto; --apply solo en dev. Prod: mismo criterio, con ledger y OK explicito.
//   node scripts/data-fixes/2026-11-16-ds-aprobaciones-dev.mjs --env dev [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev.'); process.exit(1); }
const apply = argv.includes('--apply');
const DUDOSAS = /^(PANEL FILLER|FREEZER|PATA de CABRA 1"|DISCO de CORTE|CAJA 2X4|ONE PIECE WALER|WEDGE BOLT|CABEZAL AJUSTABLE|CINTA ADHESIVA HIGHLAND|DISPENSADOR)/i;
const props = await consulta(env, "select p.id, a.nombre as sgc from sgc.odoo_homologacion_propuestas p join sgc.articulos a on a.id=p.articulo_id where p.estado='propuesta' order by p.score desc");
const ok = props.filter((p) => !DUDOSAS.test(p.sgc)); const dud = props.filter((p) => DUDOSAS.test(p.sgc));
console.log(`propuestas pendientes ${props.length}: aprobar ${ok.length}, dejar pendientes ${dud.length}`);
dud.forEach((d) => console.log('  pendiente:', d.sgc));
const ctas = await consulta(env, "select id from sgc.proyecto_odoo_analiticas where confirmado is not true");
console.log(`cuentas analiticas por confirmar: ${ctas.length}`);
if (!apply) { console.log('dry-run (use --apply)'); process.exit(0); }
const q = [`select set_config('request.jwt.claims','{"role":"service_role"}',true)`,
  ...ok.map((p) => `select sgc.odoo_propuesta_decidir('${p.id}', true)`),
  ...ctas.map((c) => `select sgc.odoo_analitica_confirmar('${c.id}', true)`)].join(';\n');
await consulta(env, `begin;\n${q};\ncommit;`);
const r = await consulta(env, "select (select count(*) from sgc.articulos where odoo_product_id is not null) vinculados, (select count(*) from sgc.odoo_homologacion_propuestas where estado='propuesta') pendientes, (select count(*) from sgc.proyecto_odoo_analiticas where confirmado) confirmadas");
console.log(r[0]);
