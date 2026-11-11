// scripts/data-fixes/2026-11-10-dm5-cerrar-reportes-raykler.mjs — CD10/DM-19
// Cierra 2 de los 4 reportes de Soporte de Raykler (ronda DM) vía
// sgc.cambiar_estado_reporte (admin-only, auditado). Los otros 2 (c1102070,
// 1e56426e) se dejan abiertos/en_progreso con respuesta — ver DM-22/DM-23.
//
//   node scripts/data-fixes/2026-11-10-dm5-cerrar-reportes-raykler.mjs --env dev
//   node scripts/data-fixes/2026-11-10-dm5-cerrar-reportes-raykler.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

// En prod SOLO se cierra 1a91a8cd: su arreglo es 100% de servidor (DH2) y ya
// está aplicado ahí. Los otros 3 dependen de código de esta rama
// (feature/dm-modulo-claude) que todavía no llegó a main/prod — cerrarlos
// ahora mentiría sobre el estado real. En dev, donde SÍ corre el código de la
// rama, se cierran los 4.
const REPORTES_TODOS = [
  {
    id: '28e423b1-8ea9-41b7-9755-a6d9f4f62feb',
    estado: 'resuelto',
    nota: 'Ya no te deja en un callejón sin salida: cuando falta recibir renglones de una orden, el aviso ahora trae un botón "Registrar entrada ahora" que te lleva directo a hacerlo (actualización 1.213.0).',
  },
  {
    id: '1a91a8cd-942a-4179-ae42-db3a4ce37bbb',
    estado: 'resuelto',
    nota: 'Era un vehículo que el mismo día tenía un mantenimiento con más kilometraje que la echada que intentabas registrar — ya está corregido en el servidor (actualización 1.213.0). Si te vuelve a pasar con otro vehículo, dime cuál y el kilometraje que intentabas poner.',
  },
  {
    id: 'c1102070-bae5-436d-bb62-6478e013788f',
    estado: 'en_progreso',
    nota: 'Revisé la pantalla pero la foto no mostraba el error exacto. Sí encontré y corregí un posible origen: el botón "Quitar" de un renglón podía fallar sin avisar en algunos navegadores (actualización 1.213.0). Si te vuelve a pasar, dime en qué requisición y qué renglón estabas reasignando.',
  },
  {
    id: '1e56426e-2f76-44c4-8548-d92f36b01b08',
    estado: 'resuelto',
    nota: 'Agregado: en el detalle de un conduce ahora hay "← Anterior · Siguiente →" (también con las flechas del teclado) y un botón "Siguiente pendiente para mí" que te lleva directo al próximo conduce que esperas firmar o confirmar (actualización 1.213.0).',
  },
];

const REPORTES = env.entorno === 'prod'
  ? REPORTES_TODOS.filter((r) => r.id === '1a91a8cd-942a-4179-ae42-db3a4ce37bbb')
  : REPORTES_TODOS;

const sql = `
do $$
declare
  v_admin uuid;
begin
  select id into v_admin from sgc.usuarios where nombre = 'Xaviel Terrero' limit 1;
  if v_admin is null then raise exception 'No se encontró el usuario Xaviel Terrero'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  ${REPORTES.map(
    (r) => `perform sgc.cambiar_estado_reporte('${r.id}'::uuid, '${r.estado}', '${r.nota.replace(/'/g, "''")}');`,
  ).join('\n  ')}

  raise notice 'OK — % reportes actualizados.', ${REPORTES.length};
end $$;
`;

await dbQuery(env, sql);
console.log(`✓ ${REPORTES.length} reportes actualizados en ${env.entorno}:`);
for (const r of REPORTES) console.log(`  - ${r.id} → ${r.estado}`);
