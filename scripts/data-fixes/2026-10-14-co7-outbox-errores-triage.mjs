// scripts/data-fixes/2026-10-14-co7-outbox-errores-triage.mjs — PROMPT-98 F5 (CO7)
// Triage de los grupos de error YA arreglados en una ronda pasada (solo faltaba
// marcarlos) + los 6 outbox atascados de prod (regla 18/19/CD10).
//
//   node scripts/data-fixes/2026-10-14-co7-outbox-errores-triage.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-14-co7-outbox-errores-triage.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-14-co7-outbox-errores-triage.mjs --env prod --apply --yes
//
// Grupos de error — causa archivo:línea + arreglo + versión real de cierre:
//   - "column \"m\" does not exist" → CE15 (sql/2026-10-01-*, PROMPT-78), unnest sin
//     alias en echadas_sospechosas. Cerrado en 1.151.0 (último error: 1.150.0).
//   - FK conduces_externos_transporta_proveedor_id_fkey → BT7 (17/09), proveedores
//     unificados. Cerrado en 1.138.0 (últimos errores: 2.24.1/2.25.0, previos).
//   - check constraint entradas_inventario_origen_tipo_chk → hotfix del mismo día
//     (sql/2026-09-22-hotfix-origen-tipo-traslado.sql) agregó 'traslado_almacen'.
//     Cerrado en 1.142.0 (23/09, un día después del hotfix; últimos errores 22/09).
//
// Outbox atascados (6, todos del 18-22/09 salvo 1 de Manolo 12-oct):
//   - 5x conduce_confirmar (23514, mismo check constraint de arriba, YA arreglado)
//     → pedir reintento (si el chofer vuelve a sincronizar, ahora sí entra).
//   - 1x combustible (RLS, Manolo Durán, client_uuid = 939a7f23…) → ES el mismo
//     client_uuid de la echada que SÍ quedó guardada (ver F0 CO3): este outbox es
//     un reintento huérfano del mismo incidente de doble-toque, no hay dato
//     perdido → resolver con nota.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

const [admin] = await dbQuery(env, `
  select u.id from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo = 'admin' and u.nombre ilike 'Xaviel%'
  order by u.created_at asc limit 1`);
const comoAdmin = (sql) => `
  select set_config('request.jwt.claims', json_build_object('sub','${admin.id}','role','authenticated')::text, true);
  select set_config('role','authenticated', true);
  ${sql}`;

const GRUPOS_RESUELTOS = [
  { contiene: 'column "m" does not exist', version: '1.151.0', nota: 'CE15 — unnest sin alias en echadas_sospechosas; corregido 01-oct.' },
  { contiene: 'conduces_externos_transporta_proveedor_id_fkey', version: '1.138.0', nota: 'BT7 — proveedores unificados (proveedores_transporte quedó vacía/retirada); FK re-apuntada.' },
  { contiene: 'entradas_inventario_origen_tipo_chk', version: '1.142.0', nota: "Hotfix 22-sep (sql/2026-09-22-hotfix-origen-tipo-traslado.sql) agregó 'traslado_almacen' al CHECK." },
];

console.log('\n=== Grupos de error a marcar SOLUCIONADO ===');
for (const g of GRUPOS_RESUELTOS) {
  const firmas = await dbQuery(env, `
    select distinct sgc.error_firma(message) as firma
    from sgc.app_error_reports where message ilike '%${g.contiene.replace(/'/g, "''")}%'`);
  for (const f of firmas) {
    const [estado] = await dbQuery(env, `select estado from sgc.app_error_estados where firma = '${f.firma.replace(/'/g, "''")}'`);
    console.log(`  ${APPLY ? 'marcando' : '(dry-run) marcaría'} solucionado v${g.version}: "${f.firma.slice(0, 70)}" (estado actual: ${estado?.estado ?? 'abierto'})`);
    if (APPLY) {
      await dbQuery(env, comoAdmin(`select sgc.marcar_error_estado('${f.firma.replace(/'/g, "''")}', 'solucionado', '${g.nota.replace(/'/g, "''")}', '${g.version}');`));
    }
  }
}

console.log('\n=== Outbox atascados ===');
const outbox = await dbQuery(env, `
  select id, tipo_op, error_code, usuario_nombre, dedup_key, primera_vez::text
  from sgc.outbox_atascados where resuelto = false order by tipo_op, primera_vez`);
for (const o of outbox) {
  if (o.tipo_op === 'conduce_confirmar' && o.error_code === '23514') {
    console.log(`  ${APPLY ? 'pidiendo reintento' : '(dry-run) pediría reintento'}: ${o.tipo_op} · ${o.usuario_nombre} · ${o.primera_vez}`);
    if (APPLY) await dbQuery(env, comoAdmin(`select sgc.outbox_atascado_pedir_reintento('${o.id}'::uuid);`));
  } else if (o.tipo_op === 'combustible' && o.dedup_key === '939a7f23-c238-4427-9680-aed5b658ad45') {
    console.log(`  ${APPLY ? 'resolviendo con nota' : '(dry-run) resolvería con nota'}: ${o.tipo_op} · ${o.usuario_nombre} (misma echada ya guardada por otra vía, CO3)`);
    if (APPLY) {
      await dbQuery(env, comoAdmin(`select sgc.outbox_atascado_resolver('${o.id}'::uuid, true, 'CO7 — reintento huérfano del incidente de doble-toque de Manolo (12-oct); la echada SÍ se guardó por otra vía (ver resolver_duplicado_echada). Sin dato perdido.');`));
    }
  } else {
    console.log(`  ⚠️ sin regla de triage para: ${o.tipo_op} / ${o.error_code} — revisar a mano.`);
  }
}

console.log(APPLY ? '\n✅ aplicado.' : '\n(dry-run) usa --apply para ejecutar.');
