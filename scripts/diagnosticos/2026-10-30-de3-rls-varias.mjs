import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
for (const t of ['avisos_flota', 'solicitudes_compra', 'reportes_usuario', 'avisos_proyecto']) {
  console.log(`=== ${t} ===`);
  console.log(JSON.stringify(await dbQuery(env, `
    select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
    from pg_policy where polrelid = 'sgc.${t}'::regclass;
  `), null, 2));
}
