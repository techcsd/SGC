// scripts/diagnosticos/2026-10-29-db-diagnostico.mjs — PROMPT-124 F0 (reglas 18/19)
// Diagnóstico SOLO LECTURA de la ronda DB vía Management API.
// Cubre: ledger cz1/cw4, DB7 (CORS preflight + logs edge assistant), DB8 (reporte
// #03fcdf2a + validar_km_vehiculo + versión web), DB9 (reporte #e665fd63 +
// aprobar_requisicion), DB10/DB11 (envios_automaticos + destinatarios), DB12 (Joan:
// vehículos visibles, asignaciones, usos cerrados por cron, L473027), DB13 (errores
// de Sonia) y Realtime (publicación supabase_realtime).
//
//   node scripts/diagnosticos/2026-10-29-db-diagnostico.mjs --env dev
//   node scripts/diagnosticos/2026-10-29-db-diagnostico.mjs --env prod --yes
//
// Salida: qa/db-diagnostico-<env>.md (gitignored: trae nombres/datos personales).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const env = await resolverEnv(process.argv.slice(2));
const q = async (sql) => { try { return await dbQuery(env, sql); } catch (e) { return { error: String(e.message).slice(0, 400) }; } };

const out = [];
const h = (s) => out.push(`\n## ${s}\n`);
const tbl = (rows) => {
  if (!rows) { out.push('_(null)_\n'); return; }
  if (rows.error) { out.push(`_(error: ${rows.error})_\n`); return; }
  if (!rows.length) { out.push('_(sin filas)_\n'); return; }
  const cols = Object.keys(rows[0]);
  out.push(`| ${cols.join(' | ')} |`);
  out.push(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
  out.push('');
};

const JOAN = '48b2fa80-cb42-48f3-9c03-2ad68ec1356b';
const SONIA = '4a89bade-5872-41dd-b491-64a920079e26';

out.push(`# Ronda DB — Diagnóstico F0 (solo lectura) — ${new Date().toISOString()}`);
out.push(`Entorno: **${env.entorno}** (${env.ref})\n`);

// ── Ledger: cz1 + cw4 ─────────────────────────────────────────────────────────
h('Ledger: cz1 (combustible retro) y cw4 (rendimiento) aplicadas');
tbl(await q(`select archivo, entorno, aplicada_en::text from sgc.migraciones_aplicadas
  where archivo ilike '%cz1%' or archivo ilike '%cw4%' order by archivo`));

// ── DB8: reporte #03fcdf2a + versión web registrada ──────────────────────────
h('DB8 — reporte #03fcdf2a (texto completo) y #e665fd63');
tbl(await q(`select left(id::text,8) as id, tipo, asunto, left(descripcion, 400) as descripcion,
  estado, respuesta_admin, created_at::text
  from sgc.reportes_usuario where id::text like '03fcdf2a%' or id::text like 'e665fd63%'`));

h('DB8 — versión web registrada (últimas 3)');
tbl(await q(`select plataforma, version, created_at::text, deploy_url from sgc.app_versiones
  where plataforma='web' order by created_at desc limit 3`));

h('DB8 — vehículo del caso (lectura actual ~71480 / intento 70147)');
tbl(await q(`select distinct v.id, v.placa, v.marca, v.modelo from sgc.vehiculos v
  join sgc.registros_combustible rc on rc.vehiculo_id = v.id
  where rc.kilometraje between 69500 and 72000 limit 10`));

h('DB8 — timeline de km del/los vehículos candidatos (últimas 12 echadas)');
tbl(await q(`select v.placa, rc.fecha::text, rc.kilometraje, rc.galones, rc.retroactiva, rc.created_at::text
  from sgc.registros_combustible rc join sgc.vehiculos v on v.id = rc.vehiculo_id
  where rc.vehiculo_id in (select vehiculo_id from sgc.registros_combustible
                           where kilometraje between 69500 and 72000)
  order by rc.fecha desc limit 14`));

// ── DB9: aprobar_requisicion — ¿capa por pendiente? ──────────────────────────
h('DB9 — definición de aprobar_requisicion (busca uso de requisicion_item_pendiente)');
const defAprobar = await q(`select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='sgc' and p.proname='aprobar_requisicion'`);
if (defAprobar?.length) {
  const def = defAprobar[0].def || '';
  const usaPendiente = /requisicion_item_pendiente|pendiente/i.test(def);
  out.push(`- Funciones encontradas: ${defAprobar.length}`);
  out.push(`- ¿Menciona "pendiente"? **${usaPendiente}**`);
  out.push('```sql\n' + def.slice(0, 6000) + '\n```');
} else tbl(defAprobar);

h('DB9 — requisicion_avance del caso BASE 100X100CM (cubierto>0)');
tbl(await q(`select r.folio, r.estado, a.*
  from sgc.solicitudes_material r,
       lateral sgc.requisicion_avance(r.id) a
  where r.created_at >= '2026-10-10'
  order by r.created_at desc limit 20`));

// ── DB10/DB11: envíos automáticos y destinatarios ────────────────────────────
h('DB10/DB11 — envios_automaticos (todas las familias)');
tbl(await q(`select familia, nombre, activo, ultimo_envio::text from sgc.envios_automaticos order by familia`));

h('DB11 — destinatarios_resumen_operaciones() hoy');
tbl(await q(`select * from sgc.destinatarios_resumen_operaciones()`));

h('DB10 — destinatarios_rendimiento_vehiculos() hoy');
tbl(await q(`select * from sgc.destinatarios_rendimiento_vehiculos()`));

h('DB10/DB11 — parámetros de roles/correos actuales');
tbl(await q(`select clave, valor from sgc.parametros
  where clave ilike '%resumen_operaciones%' or clave ilike '%rendimiento_vehiculos%' or clave ilike '%correos_extra%'`));

h('DB10 — roles de Sócrates, Eduardo, Hector, Raykler, Joan, Sonia');
tbl(await q(`select u.nombre, u.email, u.activo,
  array_agg(distinct r.codigo) filter (where r.codigo is not null) as roles
  from sgc.usuarios u
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where u.nombre ilike '%socrates%' or u.nombre ilike '%sócrates%' or u.nombre ilike '%eduardo%'
     or u.nombre ilike '%hector%' or u.nombre ilike '%héctor%' or u.nombre ilike '%raykler%'
     or u.id in ('${JOAN}','${SONIA}')
  group by u.id order by u.nombre`));

// ── DB12: Joan — qué ve y por qué ────────────────────────────────────────────
h('DB12 — vehículos activos: visibilidad para choferes');
tbl(await q(`select v.placa, v.marca, v.modelo, v.estado, v.activo, v.visible_choferes,
  (select u.nombre from sgc.usuarios u where u.id = v.responsable_id) as responsable
  from sgc.vehiculos v where v.activo = true order by v.visible_choferes desc, v.placa`));

h('DB12 — asignaciones de Joan (todas)');
tbl(await q(`select va.vehiculo_id, v.placa, va.activa, va.desde::text, va.hasta::text, va.origen
  from sgc.vehiculo_asignaciones va join sgc.vehiculos v on v.id = va.vehiculo_id
  where va.usuario_id = '${JOAN}' order by va.desde desc limit 10`));

h('DB12 — usos de Joan (últimos 14 días, con notas)');
tbl(await q(`select v.placa, vu.inicio_at::text, vu.fin_at::text,
  left(coalesce(vu.notas,''), 160) as notas
  from sgc.vehiculo_usos vu join sgc.vehiculos v on v.id = vu.vehiculo_id
  where vu.usuario_id = '${JOAN}' and vu.inicio_at >= now() - interval '14 days'
  order by vu.inicio_at desc limit 20`));

h('DB12 — quién tiene L473027 hoy (uso abierto)');
tbl(await q(`select v.placa, u.nombre, vu.inicio_at::text
  from sgc.vehiculo_usos vu
  join sgc.vehiculos v on v.id = vu.vehiculo_id
  join sgc.usuarios u on u.id = vu.usuario_id
  where v.placa ilike '%L473027%' and vu.fin_at is null`));

h('DB12 — asignaciones activas de L473027 y MT 03');
tbl(await q(`select v.placa, u.nombre as asignado_a, va.activa, va.desde::text, va.hasta::text
  from sgc.vehiculo_asignaciones va
  join sgc.vehiculos v on v.id = va.vehiculo_id
  join sgc.usuarios u on u.id = va.usuario_id
  where (v.placa ilike '%L473027%' or v.placa ilike '%MT%03%' or v.alias ilike '%MT%03%')
  order by va.desde desc limit 10`));

h('DB12 — cron cerrar_usos_huerfanos: definición actual');
const defCron = await q(`select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='sgc' and p.proname='cerrar_usos_huerfanos'`);
if (defCron?.length) out.push('```sql\n' + defCron[0].def.slice(0, 3500) + '\n```');
else tbl(defCron);

// ── DB13: Sonia — errores registrados ────────────────────────────────────────
h('DB13 — sgc.errores de Sonia (últimos 14 días)');
tbl(await q(`select e.created_at::text, e.source, e.error_type, left(e.message, 260) as message,
  e.app_version, left(coalesce(e.context::text,''), 120) as context
  from sgc.app_error_reports e where e.user_id = '${SONIA}'
  and e.created_at >= now() - interval '14 days' order by e.created_at desc limit 25`));

h('DB13/DB14 — firmas text/html y sw_update (todos los usuarios, 14 días)');
tbl(await q(`select left(e.message, 120) as message, e.source, count(*) as veces,
  count(distinct e.user_id) as usuarios, max(e.created_at)::text as ultimo,
  array_agg(distinct e.app_version) as versiones
  from sgc.app_error_reports e
  where (e.message ilike '%not a valid JavaScript MIME type%'
      or e.message ilike '%sw_update%' or e.message ilike '%dynamically imported module%'
      or e.message ilike '%ChunkLoadError%' or e.message ilike '%module script failed%')
    and e.created_at >= now() - interval '14 days'
  group by left(e.message, 120), e.source order by max(e.created_at) desc limit 15`));

// ── Realtime ──────────────────────────────────────────────────────────────────
h('Realtime — tablas en la publicación supabase_realtime');
tbl(await q(`select schemaname, tablename from pg_publication_tables
  where pubname = 'supabase_realtime' order by schemaname, tablename`));

// ── DB7: CORS preflight real contra assistant ────────────────────────────────
h('DB7 — preflight OPTIONS contra assistant (origen → status / allow-origin)');
const origenes = [
  'https://sgcconstructorasd.com',
  'https://www.sgcconstructorasd.com',
  'https://dev.sgcconstructorasd.com',
  'https://app.sgcconstructorasd.com',
  'https://app-dev.sgcconstructorasd.com',
  'http://localhost:4200',
  'https://localhost',
  'capacitor://localhost',
  'https://origen-malicioso.example.com',
];
for (const origin of origenes) {
  try {
    const res = await fetch(`${env.url}/functions/v1/assistant`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, apikey',
      },
    });
    const acao = res.headers.get('access-control-allow-origin') ?? '(sin header)';
    out.push(`- \`${origin}\` → HTTP ${res.status} · ACAO: \`${acao}\``);
  } catch (e) {
    out.push(`- \`${origin}\` → ERROR: ${String(e.message).slice(0, 120)}`);
  }
}

// ── DB7: logs de la edge assistant (Management API analytics) ────────────────
h('DB7 — logs de assistant (últimas 24h vía logs.all; luego ventanas hacia atrás)');
async function logsVentana(horasAtras, horasFin) {
  const endT = new Date(Date.now() - horasFin * 3600e3).toISOString();
  const startT = new Date(Date.now() - horasAtras * 3600e3).toISOString();
  const sql = `select id, edge_logs.timestamp, event_message, response.status_code
    from edge_logs
    cross join unnest(metadata) as m
    cross join unnest(m.response) as response
    where event_message like '%assistant%' and response.status_code >= 400
    order by timestamp desc limit 40`;
  const u = `https://api.supabase.com/v1/projects/${env.ref}/analytics/endpoints/logs?iso_timestamp_start=${encodeURIComponent(startT)}&iso_timestamp_end=${encodeURIComponent(endT)}&sql=${encodeURIComponent(sql)}`;
  const res = await fetch(u, { headers: { Authorization: `Bearer ${env.token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
for (const [a, b] of [[24, 0], [72, 24], [168, 72]]) {
  const r = await logsVentana(a, b);
  out.push(`\n**Ventana -${a}h a -${b}h** → HTTP ${r.status}`);
  const rows = r.body?.result ?? [];
  if (!rows.length) out.push(`_(sin filas 4xx/5xx; raw: ${JSON.stringify(r.body).slice(0, 300)})_`);
  for (const row of rows.slice(0, 25)) out.push(`- ${row.timestamp ?? ''} · ${row.status_code ?? ''} · ${String(row.event_message ?? '').slice(0, 160)}`);
}

// boot errors / console errors de la función assistant
h('DB7 — function_logs (boot/console errors, últimas 72h)');
{
  const endT = new Date().toISOString();
  const startT = new Date(Date.now() - 72 * 3600e3).toISOString();
  const sql = `select id, function_logs.timestamp, event_message, m.level
    from function_logs
    cross join unnest(metadata) as m
    where m.function_id is not null and (m.level in ('error','warn') or event_message like '%assistant%')
    order by timestamp desc limit 40`;
  const u = `https://api.supabase.com/v1/projects/${env.ref}/analytics/endpoints/logs?iso_timestamp_start=${encodeURIComponent(startT)}&iso_timestamp_end=${encodeURIComponent(endT)}&sql=${encodeURIComponent(sql)}`;
  const res = await fetch(u, { headers: { Authorization: `Bearer ${env.token}` } });
  const body = await res.json().catch(() => ({}));
  out.push(`HTTP ${res.status}`);
  const rows = body?.result ?? [];
  if (!rows.length) out.push(`_(sin filas; raw: ${JSON.stringify(body).slice(0, 300)})_`);
  for (const row of rows.slice(0, 30)) out.push(`- ${row.timestamp ?? ''} · ${row.level ?? ''} · ${String(row.event_message ?? '').slice(0, 200)}`);
}

mkdirSync('qa', { recursive: true });
const file = `qa/db-diagnostico-${env.entorno}.md`;
writeFileSync(file, out.join('\n'), 'utf8');
console.log(`OK → ${file} (${out.length} líneas)`);
