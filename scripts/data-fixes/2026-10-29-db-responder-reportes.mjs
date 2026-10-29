// scripts/data-fixes/2026-10-29-db-responder-reportes.mjs — Ronda DB (F1, DB8/DB9)
// Responde y cierra los dos reportes de Raykler (solo existen en PROD):
//   #03fcdf2a «ERROR AL REGISTRAR UNA HECHADA ANTERIOR» — repetido de CZ1, ya
//     corregido en prod (verificado en F0: validar_km_vehiculo acepta el caso real
//     70,147 km @ 23-oct en L542136, y la echada retro quedó registrada el 26-oct).
//   #e665fd63 «Asignar los articulos que fueron cubierto» — el formulario de aprobar
//     ahora siembra el PENDIENTE (db4 + mapper DB9).
//
// Escritura mínima y auditada: sgc.cambiar_estado_reporte (RPC admin-only, CX2),
// ejecutada con el jwt del admin de Tecnología. DRY-RUN por defecto; --apply escribe.
//
//   node scripts/data-fixes/2026-10-29-db-responder-reportes.mjs --env prod --yes          (dry-run)
//   node scripts/data-fixes/2026-10-29-db-responder-reportes.mjs --env prod --yes --apply
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

const RESPUESTAS = [
  {
    prefijo: '03fcdf2a',
    estado: 'resuelto',
    nota: 'Ya puedes registrar una echada con fecha anterior: desde la actualización del 26-oct el sistema compara el kilometraje con la lectura que el vehículo tenía EN ESA FECHA, no con la de hoy (si el número luce bajo, te pide confirmar con un aviso ámbar, no te bloquea). Lo comprobamos con tu caso real: 70,147 km con fecha 23-oct en L542136 ya pasa, y tu registro retroactivo del 26-oct quedó guardado correctamente. Si te vuelve a salir el error, cierra y vuelve a abrir la página para tomar la versión nueva.',
  },
  {
    prefijo: 'e665fd63',
    estado: 'resuelto',
    nota: 'No tienes que asignar lo cubierto a mano: el material que llega a la obra y coincide con un renglón del pedido ya descuenta del pendiente automáticamente. Lo que faltaba era que el formulario de aprobar lo mostrara — en la próxima versión cada renglón se propone con la cantidad A DESPACHAR (pedido − cubierto − despachado) y una línea «Pedido 200 · cubierto 15 · a despachar 185», con su etiqueta «Cubierto». Además el sistema ahora recorta en el servidor cualquier cantidad por encima del pendiente real.',
  },
];

const [admin] = await dbQuery(env, `
  select u.id, u.nombre from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo = 'admin' and u.email = 'tecnologia@constructorasd.com' limit 1`);
if (!admin) throw new Error('No se encontró el admin de Tecnología');
console.log(`Admin que firma: ${admin.nombre} (${admin.id}) · entorno ${env.entorno} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

for (const r of RESPUESTAS) {
  const [rep] = await dbQuery(env, `
    select id, left(id::text,8) as corto, asunto, estado, respuesta_admin is not null as ya_respondido
    from sgc.reportes_usuario where id::text like '${r.prefijo}%'`);
  if (!rep) { console.log(`- #${r.prefijo}: NO EXISTE en ${env.entorno} (nada que hacer)`); continue; }
  console.log(`- #${rep.corto} «${rep.asunto}» estado=${rep.estado} ya_respondido=${rep.ya_respondido}`);
  if (rep.estado === 'resuelto') { console.log('  ya está resuelto, no se toca'); continue; }
  if (!APPLY) { console.log(`  DRY-RUN → pasaría a '${r.estado}' con respuesta (${r.nota.length} chars)`); continue; }
  const nota = r.nota.replace(/'/g, "''");
  await dbQuery(env, `
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true);
    select sgc.cambiar_estado_reporte('${rep.id}'::uuid, '${r.estado}', '${nota}');`);
  console.log(`  ✓ respondido y marcado '${r.estado}'`);
}
