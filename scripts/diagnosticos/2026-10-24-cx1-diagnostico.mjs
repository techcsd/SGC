// scripts/diagnosticos/2026-10-24-cx1-diagnostico.mjs — PROMPT-116 FASE 3 (CX1)
// Diagnóstico SOLO LECTURA (select) de las llamadas con ok=false de los últimos
// 7 días en sgc.claude_llamadas, vía Management API.
//
//   node scripts/diagnosticos/2026-10-24-cx1-diagnostico.mjs --env prod
//
// Salida: qa/cx1-diagnostico-<env>.md (gitignored: puede traer nombres).
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

out.push(`# CX1 — Diagnóstico de errores del conector (solo lectura) — ${new Date().toISOString().slice(0, 10)}\n`);
out.push(`Entorno: **${env.entorno}** (${env.ref})\n`);

h('Resumen (consulta directa — la RPC claude_admin_resumen() exige auth.uid(), no disponible vía Management API)');
tbl(await q(`
  select
    (select count(distinct usuario_id) from sgc.claude_llamadas) as personas_conectadas,
    (select count(*) from sgc.claude_llamadas where creado_en > now() - interval '7 days') as consultas_7d,
    (select count(*) from sgc.claude_llamadas where not ok and creado_en > now() - interval '7 days') as con_error_7d
`));

h('Llamadas con ok=false, últimos 7 días (detalle completo)');
tbl(await q(`
  select l.creado_en::text as cuando, u.nombre as persona, l.herramienta,
         l.error, l.params_resumen::text as parametros, l.duracion_ms
  from sgc.claude_llamadas l
  join sgc.usuarios u on u.id = l.usuario_id
  where not l.ok and l.creado_en > now() - interval '7 days'
  order by l.creado_en desc
`));

h('Conteo de errores por herramienta (7 días)');
tbl(await q(`
  select herramienta, count(*) as n
  from sgc.claude_llamadas
  where not ok and creado_en > now() - interval '7 days'
  group by herramienta
  order by n desc
`));

h('Conteo de errores por persona (7 días)');
tbl(await q(`
  select u.nombre as persona, count(*) as n
  from sgc.claude_llamadas l join sgc.usuarios u on u.id = l.usuario_id
  where not l.ok and l.creado_en > now() - interval '7 days'
  group by u.nombre
  order by n desc
`));

h('Personas conectadas y sus módulos/roles (para cruzar con los errores de permiso)');
tbl(await q(`
  select u.nombre, array_agg(distinct r.codigo) as roles,
    (select array_agg(distinct m) from sgc.usuarios_roles ur2 join sgc.roles ro2 on ro2.id = ur2.rol_id, unnest(ro2.modulos) m where ur2.usuario_id = u.id) as modulos
  from sgc.claude_llamadas l
  join sgc.usuarios u on u.id = l.usuario_id
  left join sgc.usuarios_roles ur on ur.usuario_id = u.id
  left join sgc.roles r on r.id = ur.rol_id
  where l.creado_en > now() - interval '7 days'
  group by u.id, u.nombre
`));

mkdirSync('qa', { recursive: true });
const path = join('qa', `cx1-diagnostico-${env.entorno}.md`);
writeFileSync(path, out.join('\n'), 'utf8');
console.log(`✓ Diagnóstico CX1 escrito en ${path}`);
