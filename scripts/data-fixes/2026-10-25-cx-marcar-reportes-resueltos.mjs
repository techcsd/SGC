// scripts/data-fixes/2026-10-25-cx-marcar-reportes-resueltos.mjs — CD10
// Marca los 5 reportes de Raykler (ronda CX) como "resuelto" vía
// sgc.cambiar_estado_reporte (la ÚNICA escritura directa del conector, admin-only,
// auditada por el trigger genérico de la tabla). Corre como Xaviel (admin real),
// nunca con llave de servicio ni bypaseando el RPC.
//
//   node scripts/data-fixes/2026-10-25-cx-marcar-reportes-resueltos.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const REPORTES = [
  {
    id: 'bc51f4fa-d55e-4a36-b448-473c64ddccfa',
    asunto: 'Error al momento de acceder en el dasborard',
    nota: 'Ya puedes entrar a Entregas por confirmar desde el inicio: la tarjeta te lleva ahora a donde tú sí tienes acceso (Inventario › Conduces, pestaña «Por confirmar»).',
  },
  {
    id: '88dabdce-bcbe-4a47-b1a2-13728dfdd35f',
    asunto: 'filtrar',
    nota: 'Los filtros que pones en Conduces (y en Entradas, Salidas, Requisiciones y Movimientos) ahora se mantienen mientras sigas en Inventario, aunque entres a ver un conduce y regreses. Se limpian al cambiar de módulo o cerrar sesión.',
  },
  {
    id: '739055f4-0b88-4b40-9c06-f9fe0ab686c7',
    asunto: 'ERROR EN COMPRA',
    nota: 'Elegir «Sin orden asociada» o «Sin proveedor» al recibir mercancía ya no da error. Revisamos el mismo problema en el resto del sistema y agregamos una validación para que no vuelva a pasar en ninguna pantalla.',
  },
  {
    id: '1de8994b-6ecb-4de0-b30d-31d032190732',
    asunto: 'eorro',
    nota: 'Cuando se le asigna el artículo correcto a un renglón que llegó como texto libre, la requisición ahora muestra ese artículo (y abajo, en chico, lo que pidió la obra originalmente). Las fotos de los reportes ya se pueden ver en grande, con flechas si hay varias, sin salir de la pantalla.',
  },
  {
    id: 'e71f34ec-cb9b-447b-9f46-1b19abbeddda',
    asunto: 'Poner que se pueda ver el conduce sin tener que abrir y empezar el proceso, para una mejor forma de identificarlo.',
    nota: 'En la computadora ya puedes ver todo lo que trae una requisición con solo abrirla, sin tener que empezar el despacho — eso ya funcionaba. En el celular se agrega la misma vista rápida en la próxima actualización de la app.',
  },
];

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
    (r) => `perform sgc.cambiar_estado_reporte('${r.id}'::uuid, 'resuelto', '${r.nota.replace(/'/g, "''")}');`,
  ).join('\n  ')}

  raise notice 'OK — 5 reportes marcados como resuelto.';
end $$;
`;

await dbQuery(env, sql);
console.log(`✓ ${REPORTES.length} reportes marcados como resuelto en ${env.entorno}:`);
for (const r of REPORTES) console.log(`  - ${r.asunto}`);
