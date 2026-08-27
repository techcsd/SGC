// smoke-bitacora-roles.mjs — AY8 (ampliado por BC7).
// Smoke E2E por rol del flujo "enviar bitácora completa": un parte diario con
// actividades que EJERCE el camino que reventaba en BC7 (INSERT en
// bitacora_catalogo_usos). Corre como el rol REAL (JWT simulado, rol authenticated)
// y hace ROLLBACK — no deja datos. Falla con código !=0 si algún rol no puede guardar.
//
// Uso:  node scripts/smoke-bitacora-roles.mjs
// Necesita SUPABASE_ACCESS_TOKEN. No corre en prebuild (necesita DB); es on-demand.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Roles de campo que llenan bitácora. Toma un usuario real de cada uno.
const ROLES = ['ingeniero_campo', 'ingeniero_oficina', 'capataz', 'gerente_produccion'];

const usuarios = await q(`
  select distinct on (r.codigo) r.codigo as rol, u.id, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo in (${ROLES.map((r) => `'${r}'`).join(',')})
  order by r.codigo, u.nombre;
`);
const proy = await q(`select id from sgc.proyectos where coalesce(activo,true) limit 1;`);
if (!proy?.[0]?.id) { console.error('No hay proyecto activo para el smoke'); process.exit(1); }
const proyectoId = proy[0].id;

let fallos = 0;
for (const rol of ROLES) {
  const u = usuarios.find((x) => x.rol === rol);
  if (!u) { console.log(`· ${rol}: (sin usuario asignado — se omite)`); continue; }
  const acts = JSON.stringify([{ estructura: 'SMOKE_EST', actividad: 'SMOKE_ACT', cantidad: '5', unidad: 'und', es_aproximada: true }]).replace(/'/g, "''");
  const restr = JSON.stringify([{ tipo_restriccion: 'NINGUNA' }]).replace(/'/g, "''");
  try {
    const r = await q(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', json_build_object('sub','${u.id}','role','authenticated')::text, true);
      select sgc.crear_entrada_bitacora(
        p_usuario_id => '${u.id}'::uuid, p_proyecto_id => '${proyectoId}'::uuid,
        p_fecha => current_date, p_tipo => 'parte_diario', p_comentarios => 'SMOKE',
        p_actividades => '${acts}'::jsonb, p_restricciones => '${restr}'::jsonb
      ) as id;
      rollback;
    `);
    const id = Array.isArray(r) ? r.find((x) => x?.id)?.id : null;
    if (id) console.log(`✓ ${rol} (${u.nombre}) — bitácora completa OK`);
    else { console.error(`✗ ${rol} (${u.nombre}) — sin id devuelto`); fallos++; }
  } catch (e) {
    console.error(`✗ ${rol} (${u.nombre}) — ${e.message}`);
    fallos++;
  }
}

if (fallos) { console.error(`\n🔴 Smoke bitácora: ${fallos} rol(es) NO pueden guardar.`); process.exit(1); }
console.log('\n✓ Smoke bitácora OK — todos los roles de campo pueden enviar una bitácora completa.');
