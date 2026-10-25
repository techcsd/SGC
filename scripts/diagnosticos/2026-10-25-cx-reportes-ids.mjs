// scripts/diagnosticos/2026-10-25-cx-reportes-ids.mjs — solo lectura: IDs reales
// de los 5 reportes de Raykler para la Fase 5 (marcar Resuelto).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const rows = await dbQuery(env, `
  select r.id, r.tipo, r.asunto, r.estado, u.nombre as autor, r.created_at::text
  from sgc.reportes_usuario r join sgc.usuarios u on u.id = r.usuario_id
  where u.nombre ilike '%Raykler%' and r.created_at >= '2026-10-20'
  order by r.created_at
`);
console.log(JSON.stringify(rows, null, 2));
