import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
console.log(JSON.stringify(await dbQuery(env, `
  select (select max(folio) from sgc.solicitudes_material) as max_folio,
         (select last_value from sgc.solicitudes_material_folio_seq) as seq_last_value
`), null, 2));
