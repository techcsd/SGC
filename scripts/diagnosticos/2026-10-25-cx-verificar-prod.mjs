// scripts/diagnosticos/2026-10-25-cx-verificar-prod.mjs — verificación post-promoción
// (solo lectura): confirma que 1.200.0 quedó registrada y que los objetos nuevos
// de CX existen en prod.
//   node scripts/diagnosticos/2026-10-25-cx-verificar-prod.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const q = (sql) => dbQuery(env, sql);

console.log('app_versiones (última web):', JSON.stringify(await q(
  `select plataforma, version, titulo, created_at::text from sgc.app_versiones where plataforma='web' order by created_at desc limit 2`
)));
console.log('ledger (cx):', JSON.stringify(await q(
  `select archivo, entorno, aplicada_en::text from sgc.migraciones_aplicadas where archivo like '%cx%' order by aplicada_en desc`
)));
console.log('funciones nuevas existen:', JSON.stringify(await q(
  `select proname from pg_proc where pronamespace = 'sgc'::regnamespace and proname in ('listar_reportes_soporte','cambiar_estado_reporte','detalle_nota','crear_nota','mover_nota_a_grupo','claude_llamadas_filtros_disponibles') order by proname`
)));
