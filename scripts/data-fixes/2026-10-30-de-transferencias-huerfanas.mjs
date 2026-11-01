// scripts/data-fixes/2026-10-30-de-transferencias-huerfanas.mjs — Ronda DE F5 (DE-12f)
// Lista (dry-run) las ofertas de transferencia "ofrecida" que apuntan a un
// conductor SIN usuario — son ofertas "fantasma" que el receptor nunca pudo
// ver ni aceptar (el bug que esta ronda corrige hacia adelante en
// ofrecer_transferencia_conduce; esto es el barrido de lo que ya existía).
// NO modifica nada — solo reporta. Decisión de qué hacer con ellas es de Xaviel.
//
//   node scripts/data-fixes/2026-10-30-de-transferencias-huerfanas.mjs --env dev
//   node scripts/data-fixes/2026-10-30-de-transferencias-huerfanas.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const filas = await dbQuery(env, `
  select t.id, t.salida_id, t.ofrecida_en,
         round(extract(epoch from (now() - t.ofrecida_en)) / 3600, 1) as antiguedad_horas,
         coalesce(ud.nombre, dc.nombre) as de_nombre,
         coalesce(dc.nombre, 'desconocido') as a_nombre_sin_usuario,
         t.a_conductor_id
  from sgc.conduce_transferencias t
  left join sgc.conductores dc on dc.id = t.de_conductor_id
  left join sgc.usuarios ud on ud.id = dc.usuario_id
  left join sgc.conductores ac on ac.id = t.a_conductor_id
  where t.estado = 'ofrecida'
    and ac.usuario_id is null
  order by t.ofrecida_en asc;
`);

console.log(`\n[dry-run] ${env.entorno} (${env.ref}) — ofertas "ofrecida" hacia un chofer SIN usuario:\n`);
if (!filas.length) {
  console.log('  (ninguna — nada que reportar)');
} else {
  for (const f of filas) {
    console.log(
      `  · ${f.id}  salida=${f.salida_id}  de="${f.de_nombre}"  a="${f.a_nombre_sin_usuario}" (conductor ${f.a_conductor_id}, sin usuario)  ` +
      `ofrecida hace ${f.antiguedad_horas}h`,
    );
  }
  console.log(`\n  Total: ${filas.length} oferta(s) fantasma. NO se modificó nada — reportado para que Xaviel decida (cancelar / reasignar a mano).`);
}
console.log();
