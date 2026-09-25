// seed-dev.mjs — BU1 F5 — puebla el proyecto DEV leyendo de prod (service role) y
// escribiendo SOLO en dev. Aborta si el destino no es dev. Idempotente (upsert por PK).
//   node scripts/seed-dev.mjs --env dev [--refrescar]
//
// - Catálogos: copia entera. Operación: últimos N días (seed-dev.tablas.json).
// - usuarios: anonimizados (email/cédula/teléfono/avatar) + creados en Auth de dev
//   con el MISMO id (para que las FK de la operación clonada cuadren) y contraseña
//   QA (QA_DEV_PASSWORD). El nombre real SÍ se conserva (probar como Raykler/Felix).
// - Fotos NO se copian: los *_path → un placeholder subido a cada bucket.
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 seed-dev SOLO corre con --env dev.'); process.exit(1); }
const PROD = process.env.SUPABASE_PROJECT_REF_PROD || 'jeeqhgccqefbqilntcpu';
if (env.ref === PROD) { console.error('🔴 el destino es PROD — abortado.'); process.exit(1); }

const PROD_URL = process.env.SUPABASE_URL_PROD, PROD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD;
const DEV_URL = process.env.SUPABASE_URL_DEV, DEV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;
const QA_PWD = process.env.QA_DEV_PASSWORD;
if (!PROD_URL || !PROD_KEY || !DEV_URL || !DEV_KEY || !QA_PWD) { console.error('faltan SUPABASE_URL/SERVICE_ROLE de prod/dev o QA_DEV_PASSWORD en .env.local'); process.exit(1); }
const cfg = JSON.parse(readFileSync('scripts/seed-dev.tablas.json', 'utf8'));
const refrescar = process.argv.includes('--refrescar');
const PLACEHOLDER = 'dev-placeholder/foto.jpg';
const DATE_CANDIDATES = ['capturado_en', 'fecha', 'created_at', 'fecha_creacion', 'creado_en'];
const PATH_RE = /(_path|_url|^foto$|^fotos$|^firma$|avatar)/i;

// ── Guard: el destino se declara dev en config_entorno ───────────────────────
async function devSql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`devSql ${r.status}: ${await r.text()}`);
  return JSON.parse(await r.text());
}
const guard = await devSql("select valor from sgc.config_entorno where clave='entorno'");
if (!(guard[0] && guard[0].valor === 'dev')) { console.error('🔴 config_entorno.entorno != dev — abortado.'); process.exit(1); }

// ── BZ3: SQL de solo-lectura contra PROD (Management API) para saber quién conserva
// su email real en dev (admin/desarrollador/tecnologia + lista emails_reales). ──────
async function prodSql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`prodSql ${r.status}: ${await r.text()}`);
  return JSON.parse(await r.text());
}
const soloUsuarios = process.argv.includes('--solo-usuarios');

// ── Metadatos del esquema (tablas, columnas, PK, FKs) ────────────────────────
const meta = (await devSql(`select json_build_object(
  'tables',(select json_agg(t.relname order by t.relname) from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname='sgc' and t.relkind='r'),
  'columns',(select json_object_agg(tbl,cols) from (select c.relname tbl, json_agg(a.attname order by a.attnum) cols from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='sgc' and c.relkind='r' group by c.relname) z),
  'generated',(select json_object_agg(tbl,cols) from (select c.relname tbl, json_agg(a.attname) cols from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attgenerated<>'' where n.nspname='sgc' and c.relkind='r' group by c.relname) g),
  'fks',(select json_agg(json_build_object('src',sc.relname,'dst',dc.relname)) from pg_constraint k join pg_class sc on sc.oid=k.conrelid join pg_namespace sn on sn.oid=sc.relnamespace join pg_class dc on dc.oid=k.confrelid where k.contype='f' and sn.nspname='sgc' and sc.relname<>dc.relname)
) as data`))[0].data;

// ── Orden topológico por FKs (dst antes que src) ─────────────────────────────
function topoSort(tables, fks) {
  const set = new Set(tables), deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { src, dst } of (fks || [])) if (set.has(src) && set.has(dst)) deps.get(src).add(dst);
  const out = [], done = new Set();
  let progress = true;
  while (out.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((d) => done.has(d) || d === t)) { out.push(t); done.add(t); progress = true; }
    }
  }
  for (const t of tables) if (!done.has(t)) out.push(t); // ciclos → best-effort al final
  return out;
}
const order = topoSort(meta.tables, meta.fks);
const omit = new Set(cfg.omitir);
const iso30 = new Date(Date.now() - cfg.dias_operacion * 864e5).toISOString();

// ── PostgREST helpers ────────────────────────────────────────────────────────
function anonimizarFila(cols, row, gen) {
  const out = { ...row };
  for (const c of cols) {
    if (PATH_RE.test(c) && out[c] != null) out[c] = Array.isArray(out[c]) ? [PLACEHOLDER] : PLACEHOLDER;
  }
  for (const g of gen || []) delete out[g]; // columnas generadas: PostgREST las rechaza
  return out;
}
async function pgGet(table, dateCol, cap) {
  const rows = [];
  for (let offset = 0; rows.length < cap; offset += 1000) {
    let url = `${PROD_URL}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`;
    if (dateCol) url += `&${dateCol}=gte.${iso30}&order=${dateCol}.desc`;
    const r = await fetch(url, { headers: { apikey: PROD_KEY, Authorization: `Bearer ${PROD_KEY}`, 'Accept-Profile': 'sgc' } });
    if (!r.ok) throw new Error(`GET ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}
async function postRows(table, rows) {
  const r = await fetch(`${DEV_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: DEV_KEY, Authorization: `Bearer ${DEV_KEY}`, 'Content-Profile': 'sgc', 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { const e = new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
}
async function pgUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    try { await postRows(table, chunk); }
    catch (e) {
      // Fallback fila-a-fila: una fila con conflicto (unique de negocio) no debe
      // tumbar todo el lote (p. ej. conductores con usuario_id duplicado en prod).
      let filaErr = null;
      for (const row of chunk) { try { await postRows(table, [row]); } catch (e2) { filaErr = e2; } }
      if (filaErr) { const e3 = new Error(`UPSERT ${table} (parcial) ${filaErr.message}`); e3.status = filaErr.status; e3.parcial = true; throw e3; }
    }
  }
}

// ── Placeholder por bucket ───────────────────────────────────────────────────
async function subirPlaceholders() {
  const buckets = (await devSql('select id from storage.buckets')).map((b) => b.id);
  // 1x1 jpg mínimo
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  let ok = 0;
  for (const b of buckets) {
    const r = await fetch(`${DEV_URL}/storage/v1/object/${b}/${PLACEHOLDER}`, {
      method: 'POST', headers: { apikey: DEV_KEY, Authorization: `Bearer ${DEV_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: jpg,
    });
    if (r.ok) ok++;
  }
  console.log(`✓ placeholder subido a ${ok}/${buckets.length} buckets`);
}

// ── Usuarios: anonimizar + Auth (mismo id) ───────────────────────────────────
function sha(s) { return createHash('sha256').update(String(s ?? '')).digest('hex'); }
function ced11(cedula) { return (BigInt('0x' + sha(cedula).slice(0, 14)) % 100000000000n).toString().padStart(11, '0'); }
async function seedUsers() {
  const r = await fetch(`${PROD_URL}/rest/v1/usuarios?select=*`, { headers: { apikey: PROD_KEY, Authorization: `Bearer ${PROD_KEY}`, 'Accept-Profile': 'sgc' } });
  if (!r.ok) throw new Error(`GET usuarios ${r.status}`);
  const usuarios = await r.json();

  // BZ3 — quién conserva su email real en dev: la lista explícita `emails_reales` +
  // el criterio por defecto (rol admin/desarrollador, o módulo tecnologia/admin).
  const keepReal = new Set((cfg.emails_reales || []).map((e) => String(e).toLowerCase()));
  try {
    const rows = await prodSql(`select distinct lower(u.email) as email
      from sgc.usuarios u
      join sgc.usuarios_roles ur on ur.usuario_id = u.id
      join sgc.roles r on r.id = ur.rol_id
      where u.email is not null
        and (r.nombre in ('admin','desarrollador') or 'tecnologia' = any(r.modulos) or 'admin' = any(r.modulos))`);
    for (const row of rows) if (row.email) keepReal.add(row.email);
  } catch (e) { console.log(`  ⚠️ no se pudo calcular emails reales por rol (${String(e.message).slice(0, 80)}); uso solo la lista.`); }

  const q = (s) => String(s).replace(/'/g, "''");
  const authVals = [], identVals = [], devRows = [];
  let reales = 0;
  for (const u of usuarios) {
    const acceso = typeof u.email === 'string' && u.email.endsWith('@acceso.constructorasd.local');
    const c11 = ced11(u.cedula ?? u.id);
    // BZ3: admin/tecnologia/desarrollador (y la lista) mantienen su email real para
    // poder entrar en dev con sus credenciales (contraseña = QA_DEV_PASSWORD).
    const real = typeof u.email === 'string' && keepReal.has(u.email.toLowerCase());
    const email = real ? u.email
      : (acceso ? `e-${c11}@acceso.constructorasd.local` : `u-${sha(u.id).slice(0, 8)}@dev.constructorasd.local`);
    if (real) reales++;
    authVals.push(`('${u.id}'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','${q(email)}',crypt('${q(QA_PWD)}',gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"dev_seed":true}','','','','')`);
    identVals.push(`(gen_random_uuid(),'${u.id}'::uuid,jsonb_build_object('sub','${u.id}','email','${q(email)}'),'email','${u.id}',now(),now(),now())`);
    // El email real conservado también se refleja en sgc.usuarios (para el login y el panel QA).
    devRows.push({ ...u, email, cedula: real ? u.cedula : c11, telefono: real ? u.telefono : '809-000-0000', avatar_path: real ? u.avatar_path : null });
  }
  // auth.users (token cols en '' para no romper GoTrue).
  for (let i = 0; i < authVals.length; i += 100) {
    const chunk = authVals.slice(i, i + 100);
    await devSql(`insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new) values ${chunk.join(',')}
      on conflict (id) do update set email=excluded.email, encrypted_password=excluded.encrypted_password, email_confirmed_at=excluded.email_confirmed_at`);
  }
  for (let i = 0; i < identVals.length; i += 100) {
    const chunk = identVals.slice(i, i + 100);
    await devSql(`insert into auth.identities (id,user_id,identity_data,provider,provider_id,created_at,updated_at,last_sign_in_at) values ${chunk.join(',')} on conflict do nothing`);
  }
  // sgc.usuarios anonimizado (upsert por PK id).
  await pgUpsert('usuarios', devRows);
  console.log(`✓ usuarios: ${usuarios.length} en Auth (mismo id, contraseña QA); ${reales} con email real (admin/tecnologia/desarrollador + lista), ${usuarios.length - reales} anonimizados`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`▶ seed-dev → ${env.ref} (leyendo de prod, escribiendo solo en dev)\n`);

// BZ3 — refrescar solo los usuarios (emails reales + Auth) sin recopiar toda la
// operación: node scripts/seed-dev.mjs --env dev --solo-usuarios  (o npm run seed:dev -- --solo-usuarios).
if (soloUsuarios) {
  await seedUsers();
  console.log('\n✓ seed-dev --solo-usuarios: usuarios + Auth actualizados (sin recopiar operación).');
  process.exit(0);
}

await subirPlaceholders();

if (refrescar) {
  console.log('↻ --refrescar: borrando operación (tablas con columna de fecha, no catálogos)…');
  for (const t of [...order].reverse()) {
    if (omit.has(t) || t === 'usuarios') continue;
    const cols = meta.columns[t] || [];
    const dateCol = DATE_CANDIDATES.find((d) => cols.includes(d)) || cfg.date_col[t];
    if (dateCol) { try { await devSql(`delete from sgc.${t}`); } catch { /* fk: se recae */ } }
  }
}

const report = { filas: 0, saltadas: 0 };
let lastErr = new Map();
async function copyOne(t) {
  const cols = meta.columns[t] || [];
  if (t === 'usuarios') { await seedUsers(); return; }
  // Copia COMPLETA por defecto: muchas tablas de catálogo (proyectos/vehiculos/…)
  // tienen created_at, así que filtrar por fecha rompía las FK de la operación que
  // referencia filas viejas. Solo se filtran a N días las tablas listadas en
  // `operacion_reciente` (por defecto vacío). El volumen grande ya está en `omitir`.
  const gen = (meta.generated && meta.generated[t]) || [];
  const dateCol = (cfg.operacion_reciente || []).includes(t) ? (cfg.date_col[t] || DATE_CANDIDATES.find((d) => cols.includes(d))) : null;
  const cap = dateCol ? cfg.cap_operacion : cfg.cap_catalogo;
  const rows = await pgGet(t, dateCol, cap);
  if (!rows.length) return;
  const anon = rows.map((row) => anonimizarFila(cols, row, gen));
  try {
    await pgUpsert(t, anon);
  } catch (e) {
    if (/P0001|obligatoria|violates check|check constraint/i.test(e.message)) {
      // Trigger de negocio: desactiva triggers USER (FK RI siguen activas) y reintenta.
      await devSql(`alter table sgc.${t} disable trigger user`);
      try { await pgUpsert(t, anon); } finally { await devSql(`alter table sgc.${t} enable trigger user`); }
    } else if (e.parcial) {
      console.log(`  ⚠️ ${t}: cargada parcialmente (conflicto de unicidad en alguna fila de prod)`);
    } else {
      throw e; // FK sin padre → lo resuelve el multi-pase
    }
  }
  report.filas += rows.length;
  if (rows.length >= cap) console.log(`  ⚠️ ${t}: tope ${cap} alcanzado (posible truncado)`);
}

// Multi-pase: las FK se resuelven cuando el padre ya entró (orden imperfecto/ciclos).
let pending = order.filter((t) => { if (omit.has(t)) { report.saltadas++; return false; } return true; });
let done = 0;
for (let pass = 0; pass < 6 && pending.length; pass++) {
  const failed = [];
  for (const t of pending) {
    try { await copyOne(t); done++; }
    catch (e) { lastErr.set(t, String(e.message).slice(0, 160)); failed.push(t); }
  }
  console.log(`  pase ${pass + 1}: ${pending.length - failed.length} ok, ${failed.length} pendientes`);
  if (failed.length === pending.length) break; // sin progreso
  pending = failed;
}

console.log(`\n✓ seed-dev: ${done} tablas copiadas, ${report.filas} filas, ${report.saltadas} omitidas.`);
if (pending.length) {
  console.log(`\n⚠️ ${pending.length} tabla(s) sin copiar (FK sin padre / conflicto real):`);
  pending.slice(0, 40).forEach((t) => console.log(`   - ${t}: ${lastErr.get(t)}`));
}
