// scripts/diagnosticos/2026-10-14-co-diagnostico.mjs — PROMPT-98 FASE 0 (regla 18/19)
// Diagnóstico de PROD, SOLO LECTURA (select/explain), vía Management API con
// SUPABASE_ACCESS_TOKEN (service role NO se usa aquí — ver scripts/lib/entorno.mjs).
// Cubre CO1 (dispositivos/versiones), CO3 (echadas duplicadas L542136), CO5
// (conduces CND- duplicados), CO6 (consultas de Compa no atendidas), CO7 (grupos
// de error abiertos + outbox atascado).
//
//   node scripts/diagnosticos/2026-10-14-co-diagnostico.mjs --env prod
//
// Salida: qa/co-diagnostico-prod.md (gitignored: trae nombres/datos personales).
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
  const cols = Object.keys(rows[0]);
  out.push(`| ${cols.join(' | ')} |`);
  out.push(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`);
  out.push('');
};

out.push(`# CO — Diagnóstico de prod (solo lectura) — ${new Date().toISOString().slice(0, 10)}\n`);
out.push(`Entorno: **${env.entorno}** (${env.ref})\n`);

// ── CO1: dispositivos por plataforma/versión ────────────────────────────────
h('CO1 — Dispositivos por plataforma y versión');
const publicadas = await q(`
  select plataforma, version, max(version_code) as version_code
  from sgc.app_versiones where publicada = true
  group by plataforma, version
  order by plataforma, version desc`);
out.push('**Versiones publicadas (referencia):**\n');
tbl(publicadas);

const dispositivos = await q(`
  select d.plataforma, d.app_version, count(*) as equipos,
         max(d.visto_at)::text as ultimo_visto,
         string_agg(distinct u.nombre, ', ' order by u.nombre) as usuarios
  from sgc.usuario_dispositivos d
  join sgc.usuarios u on u.id = d.usuario_id
  group by d.plataforma, d.app_version
  order by d.plataforma, d.app_version`);
out.push('**Conteo de equipos por plataforma+versión:**\n');
tbl(dispositivos);

const atrasados = await q(`
  select u.nombre, d.plataforma, d.app_version, d.modelo,
         d.visto_at::text as ultimo_visto,
         round(extract(epoch from (now() - d.visto_at))/3600) as horas_desde_visto
  from sgc.usuario_dispositivos d
  join sgc.usuarios u on u.id = d.usuario_id
  where (d.plataforma = 'android' and sgc.semver_key(d.app_version) < sgc.semver_key('2.46.0'))
     or (d.plataforma in ('ios-pwa','web') and d.visto_at < now() - interval '48 hours'
         and sgc.semver_key(d.app_version) < (select max(sgc.semver_key(version)) from sgc.app_versiones where publicada=true and plataforma = d.plataforma))
  order by d.plataforma, d.visto_at desc`);
out.push('**Equipos atrasados (Android <2.46 siempre; ios-pwa/web con versión vieja y >48h sin verse):**\n');
tbl(atrasados);

// ── CO3: echadas duplicadas (Manolo Duran, L542136, 12-oct ~7:15pm) ─────────
h('CO3 — Echadas de combustible duplicadas (L542136, Manolo Duran, 12-oct ~19:15)');
const echadas = await q(`
  select rc.id, rc.client_uuid, rc.registrado_por, u.nombre as registrado_por_nombre,
         rc.created_at::text, rc.numero_recibo, rc.estado, rc.km_recorridos, rc.rendimiento_km_gal,
         rc.galones, rc.monto, v.placa, v.alias
  from sgc.registros_combustible rc
  join sgc.vehiculos v on v.id = rc.vehiculo_id
  left join sgc.usuarios u on u.id = rc.registrado_por
  where v.placa ilike '%542136%'
    and rc.created_at between '2026-10-12 00:00:00-04' and '2026-10-13 00:00:00-04'
  order by rc.created_at`);
tbl(echadas);

// ── CO5: conduces CND- duplicados ───────────────────────────────────────────
h('CO5 — Conduces CND-0CA71D59 / CND-EAFE9FCE / CND-4039EDE0');
const conduces = await q(`
  select si.id, upper(left(si.id::text,8)) as codigo, si.creado_por, u.nombre as creado_por_nombre,
         si.created_at::text, si.estado, si.bodega_id, si.destino_almacen_id, si.destino_texto,
         si.conductor_id
  from sgc.salidas_inventario si
  left join sgc.usuarios u on u.id = si.creado_por
  where upper(left(si.id::text,8)) in ('0CA71D59','EAFE9FCE','4039EDE0')
  order by si.created_at`);
tbl(conduces);

// ── CO6: 14 consultas de Compa no atendidas ─────────────────────────────────
h('CO6 — Consultas de Compa no atendidas');
const consultas = await q(`
  select c.pregunta, u.nombre as usuario, c.roles_snapshot, c.motivo, c.tool,
         c.created_at::text
  from sgc.assistant_consultas_no_atendidas c
  left join sgc.usuarios u on u.id = c.usuario_id
  where c.resuelto = false
  order by c.created_at desc`);
tbl(consultas);

// ── CO7: grupos de error abiertos ───────────────────────────────────────────
h('CO7 — Grupos de error abiertos (app_error_reports)');
const errores = await q(`
  select sgc.error_firma(r.message) as firma, r.error_type,
         count(*) as ocurrencias,
         count(distinct r.user_id) as usuarios_afectados,
         string_agg(distinct r.app_version, ', ') as versiones,
         max(r.created_at)::text as ultima_vez,
         min(r.created_at)::text as primera_vez,
         coalesce(e.estado, 'abierto') as estado,
         e.resuelto_en_version
  from sgc.app_error_reports r
  left join sgc.app_error_estados e on e.firma = sgc.error_firma(r.message)
  group by sgc.error_firma(r.message), r.error_type, e.estado, e.resuelto_en_version
  having coalesce(e.estado,'abierto') <> 'solucionado'
  order by ocurrencias desc
  limit 50`);
tbl(errores);

h('CO7 — Outbox atascados sin resolver');
const outbox = await q(`
  select tipo_op, categoria, error_kind, error_code, count(*) as items,
         count(distinct usuario_id) as usuarios,
         string_agg(distinct usuario_nombre, ', ') as nombres,
         max(ultima_vez)::text as ultima_vez,
         max(edad_horas) as edad_horas_max
  from sgc.outbox_atascados
  where resuelto = false
  group by tipo_op, categoria, error_kind, error_code
  order by items desc`);
tbl(outbox);

mkdirSync(join(process.cwd(), 'qa'), { recursive: true });
const path = join(process.cwd(), 'qa', 'co-diagnostico-prod.md');
writeFileSync(path, out.join('\n'), 'utf8');
console.log(`✅ escrito: ${path}`);
