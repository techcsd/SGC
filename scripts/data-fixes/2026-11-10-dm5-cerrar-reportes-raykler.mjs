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

// 11-nov: v1.213.0 (PR #130) ya está en main/prod, con OK explícito de Xaviel
// para cerrar los 4 reportes en prod — el código real ya está vivo ahí.
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
    // DN-25 (ronda DN, 11-nov): reproducido a nivel de servidor contra dev con
    // los mismos datos del reporte (renglón "libre" sin artículo de catálogo,
    // requisición ya en despacho) simulando la sesión real de Raykler —
    // sgc.requisicion_cancelar_item() funcionó correctamente, sin error. La
    // causa más probable sigue siendo la ya corregida en 1.213.0 (el
    // `prompt()` nativo fuera del try/catch, que en ciertos navegadores fallaba
    // en silencio sin mostrar ningún aviso). Se cierra como resuelto.
    id: 'c1102070-bae5-436d-bb62-6478e013788f',
    estado: 'resuelto',
    nota: 'Probé de nuevo "Quitar" en un renglón sin artículo del catálogo (como el tuyo) en una requisición ya en despacho, y funcionó bien. Lo más probable es que el arreglo de la actualización 1.213.0 ya lo haya corregido: antes, en algunos navegadores, el cuadro de motivo podía fallar en silencio sin avisar nada. Si te vuelve a pasar, dime en qué requisición y qué renglón estabas quitando, y qué navegador usas (Chrome, el de la app, etc.).',
  },
  {
    id: '1e56426e-2f76-44c4-8548-d92f36b01b08',
    estado: 'resuelto',
    nota: 'Agregado: en el detalle de un conduce ahora hay "← Anterior · Siguiente →" (también con las flechas del teclado) y un botón "Siguiente pendiente para mí" que te lleva directo al próximo conduce que esperas firmar o confirmar (actualización 1.213.0).',
  },
];

const REPORTES = REPORTES_TODOS;

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
