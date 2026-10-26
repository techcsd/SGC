// CY6 -- hallazgo lateral: sgc.categorias_inventario_id_seq (y de paso
// unidades_id_seq) estaban desincronizadas en dev (igual patron que
// solicitudes_material_folio_seq en la ronda CY anterior) -- bloqueaba
// crear_categoria_app/crear_unidad_app con "duplicate key". Solo dev
// (CD10/regla 18): prod tiene su propio historial de seed, no asumir que
// tiene el mismo problema sin verificar primero.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') {
  console.error('Este data-fix es SOLO para dev (no se ha verificado si prod tiene el mismo problema).');
  process.exit(1);
}

for (const tabla of ['categorias_inventario', 'unidades']) {
  const antes = await dbQuery(env, `select last_value from sgc.${tabla}_id_seq`);
  const max = await dbQuery(env, `select coalesce(max(id),0) as max from sgc.${tabla}`);
  const maxId = max[0].max;
  if (antes[0].last_value >= maxId) {
    console.log(`${tabla}: secuencia ya sincronizada (last_value=${antes[0].last_value} >= max(id)=${maxId})`);
    continue;
  }
  await dbQuery(env, `select setval('sgc.${tabla}_id_seq', ${maxId})`);
  console.log(`${tabla}: secuencia resincronizada ${antes[0].last_value} -> ${maxId}`);
}
