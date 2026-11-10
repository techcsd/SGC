import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try {
    const rows = await dbQuery(env, sql);
    console.table(rows);
  } catch (e) {
    console.log(`(error) ${e.message}`);
  }
}

for (const t of ['migraciones_aplicadas', 'app_error_reports', 'agentes', 'reportes_usuario']) {
  await q(`cols ${t}`, `select column_name, data_type from information_schema.columns where table_schema='sgc' and table_name='${t}' order by ordinal_position;`);
}
