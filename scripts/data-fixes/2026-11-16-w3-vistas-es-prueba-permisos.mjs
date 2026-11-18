// 2026-11-16 W3 (DS-41) -- prueba de permisos ANTES/DESPUES de filtrar es_prueba en 4 vistas (solo lectura, solo dev).
// Cuenta filas de cada vista, y las que son de prueba en la tabla base, vistas como cada rol (set local role authenticated + claims).
//   node scripts/data-fixes/2026-11-16-w3-vistas-es-prueba-permisos.mjs --env dev
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('Solo dev.'); process.exit(1); }

const ROLES = ['admin', 'jefe_flota', 'logistica', 'jefe_rrhh', 'gerente_proyectos', 'revisor_tiendas'];
const VISTAS = ['v_movimientos_inventario', 'v_proyecto_avance', 'v_proyecto_readiness', 'v_vehiculo_stats'];
const BASE = { v_movimientos_inventario: ['salidas_inventario', 'entradas_inventario'], v_proyecto_avance: ['proyectos'], v_proyecto_readiness: ['proyectos'], v_vehiculo_stats: ['vehiculos'] };

for (const rol of ROLES) {
  const [u] = await consulta(env, `select min(u.id::text) id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id join sgc.usuarios u on u.id=ur.usuario_id where r.codigo='${rol}'`);
  if (!u?.id) { console.log(`${rol}: sin usuario en dev`); continue; }
  const claims = JSON.stringify({ sub: u.id, role: 'authenticated' }).replace(/'/g, "''");
  const partes = VISTAS.map((v) => `select '${v}' k, count(*)::int n from sgc.${v}`)
    .concat(Object.entries(BASE).flatMap(([v, ts]) => ts.map((t) => `select 'base_prueba:${t}' k, count(*) filter (where es_prueba)::int n from sgc.${t}`)));
  const filas = await consulta(env, `begin; set local role authenticated; select set_config('request.jwt.claims','${claims}',true); ${partes.join(' union all ')};`);
  console.log(rol.padEnd(18), filas.map((f) => `${f.k}=${f.n}`).join('  '));
}
