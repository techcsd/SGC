// scripts/diagnosticos/2026-10-23-cw-diagnostico.mjs — PROMPT-114 FASE 0 (regla 18/19)
// Diagnóstico SOLO LECTURA (select) vía Management API con SUPABASE_ACCESS_TOKEN.
// Cubre CW1/CW2 (Carlos: roles, conductores, conduces pendientes/duplicados,
// outbox atascado), CW6/CW7 (Dallin: roles, fila conductores, módulos).
//
//   node scripts/diagnosticos/2026-10-23-cw-diagnostico.mjs --env prod
//   node scripts/diagnosticos/2026-10-23-cw-diagnostico.mjs --env dev
//
// Salida: qa/cw-diagnostico-<env>.md (gitignored: trae nombres/datos personales).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const env = await resolverEnv(process.argv.slice(2));
const q = (sql) => dbQuery(env, sql);

const out = [];
const h = (s) => out.push(`\n## ${s}\n`);
const tbl = (rows) => {
  if (!rows || !rows.length) { out.push('_(sin filas)_\n'); return; }
  if (rows.error) { out.push(`_(error: ${JSON.stringify(rows)})_\n`); return; }
  const cols = Object.keys(rows[0]);
  out.push(`| ${cols.join(' | ')} |`);
  out.push(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`);
  out.push('');
};

out.push(`# CW — Diagnóstico (solo lectura) — ${new Date().toISOString().slice(0, 10)}\n`);
out.push(`Entorno: **${env.entorno}** (${env.ref})\n`);

// ── CW1/CW2/CW6/CW7: Carlos y Dallin — roles, conductores, módulos ──────────
h('Usuarios: Carlos y Dallin — datos base, roles, fila en conductores (activo)');
const usuarios = await q(`
  select u.id, u.nombre, u.cedula, u.activo, u.created_at::text as creado,
         array_agg(distinct r.codigo) filter (where r.codigo is not null) as roles,
         (select count(*) from sgc.conductores c where c.usuario_id = u.id) as filas_conductores,
         (select string_agg(c.activo::text, ', ') from sgc.conductores c where c.usuario_id = u.id) as conductor_activo
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'
  group by u.id
  order by u.nombre`);
tbl(usuarios);

h('Últimos dispositivos vistos (Carlos/Dallin)');
const dispositivos = await q(`
  select u.nombre, d.plataforma, d.app_version, d.modelo, d.visto_at::text as ultimo_visto,
         round(extract(epoch from (now() - d.visto_at))/3600) as horas_desde_visto
  from sgc.usuario_dispositivos d
  join sgc.usuarios u on u.id = d.usuario_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'
  order by d.visto_at desc`);
tbl(dispositivos);

h('Última actividad de auditoría (Carlos/Dallin) — últimos 30 días');
const auditoria = await q(`
  select u.nombre, a.accion, a.tabla, a.creado_en::text
  from sgc.auditoria a
  join sgc.usuarios u on u.id = a.actor_id
  where (u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%')
    and a.creado_en > now() - interval '30 days'
  order by a.creado_en desc
  limit 60`);
tbl(auditoria);

// ── CW1: conduces "pendiente de entrega" (derivado: no es columna estado) ──
h('CW1 — Conduces "pendientes de entrega" de Carlos (y Dallin) — misma lógica que mis_conduces_pendientes_entrega');
const pendientes = await q(`
  select si.id, upper(left(si.id::text,8)) as codigo, si.estado, si.es_prueba,
         si.created_at::text, si.conductor_id, u.nombre as conductor_nombre,
         si.destino_texto, si.destino_almacen_id, si.recibido_por
  from sgc.salidas_inventario si
  join sgc.conductores c on c.id = si.conductor_id
  join sgc.usuarios u on u.id = c.usuario_id
  where (u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%')
    and coalesce(si.estado,'') not in ('entregado','entregado_incompleto','anulado')
    and si.recibido_por is null
  order by si.created_at desc`);
tbl(pendientes);

h('CW1 — Todos los conduces de Carlos/Dallin (últimos 90 días, cualquier estado)');
const todos = await q(`
  select si.id, upper(left(si.id::text,8)) as codigo, si.estado, si.es_prueba,
         si.created_at::text, u.nombre as conductor_nombre, si.destino_texto, si.recibido_por
  from sgc.salidas_inventario si
  join sgc.conductores c on c.id = si.conductor_id
  join sgc.usuarios u on u.id = c.usuario_id
  where (u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%')
    and si.created_at > now() - interval '90 days'
  order by si.created_at desc
  limit 100`);
tbl(todos);

h('CW1 — Posibles duplicados por conductor+fecha (mismo conductor, <5min de diferencia)');
const dups = await q(`
  select a.id as id_a, upper(left(a.id::text,8)) as cod_a, b.id as id_b, upper(left(b.id::text,8)) as cod_b,
         a.created_at::text as fecha_a, b.created_at::text as fecha_b, u.nombre as conductor
  from sgc.salidas_inventario a
  join sgc.salidas_inventario b on b.conductor_id = a.conductor_id and b.id > a.id
    and abs(extract(epoch from (b.created_at - a.created_at))) < 300
  join sgc.conductores c on c.id = a.conductor_id
  join sgc.usuarios u on u.id = c.usuario_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'
  order by a.created_at desc`);
tbl(dups);

// ── CW1: outbox atascado por chofer ─────────────────────────────────────────
h('CW1 — Outbox atascado de Carlos/Dallin');
const outbox = await q(`
  select o.*
  from sgc.outbox_atascados o
  where o.usuario_nombre ilike '%carlos%' or o.usuario_nombre ilike '%dallin%'
  order by o.ultima_vez desc`);
tbl(outbox);

// ── CW6/CW7: vehículo asignado en conductores + asignaciones activas ────────
h('CW6/CW7 — Vehículo en fila conductores (vehiculo_id) de Carlos/Dallin');
const conductorVeh = await q(`
  select u.nombre, c.id as conductor_id, c.vehiculo_id, v.placa, v.alias, c.activo
  from sgc.conductores c
  join sgc.usuarios u on u.id = c.usuario_id
  left join sgc.vehiculos v on v.id = c.vehiculo_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'`);
tbl(conductorVeh);

h('CW6/CW7 — Rutas creadas alguna vez por Carlos/Dallin');
const rutasCreadas = await q(`
  select r.id, upper(left(r.id::text,8)) as codigo, r.created_at::text, r.estado, u.nombre as chofer
  from sgc.rutas r
  join sgc.conductores c on c.id = r.conductor_id
  join sgc.usuarios u on u.id = c.usuario_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'
  order by r.created_at desc limit 30`);
tbl(rutasCreadas);

// ── CW6/CW7: autorizaciones de vehículo del chofer privado ──────────────────
h('CW6/CW7 — Autorizaciones de vehículo (chofer privado) de Carlos/Dallin');
const autorizaciones = await q(`
  select u.nombre, v.placa, v.alias, va.desde, va.hasta, va.activa
  from sgc.vehiculo_autorizaciones va
  join sgc.usuarios u on u.id = va.usuario_id
  left join sgc.vehiculos v on v.id = va.vehiculo_id
  where u.nombre ilike '%carlos%' or u.nombre ilike '%dallin%'
  order by u.nombre`);
tbl(autorizaciones);

mkdirSync(join(process.cwd(), 'qa'), { recursive: true });
const path = join(process.cwd(), 'qa', `cw-diagnostico-${env.entorno}.md`);
writeFileSync(path, out.join('\n'), 'utf8');
console.log(`✅ escrito: ${path}`);
