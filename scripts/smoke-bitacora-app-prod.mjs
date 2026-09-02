// smoke-bitacora-app-prod.mjs — BG2 (PROMPT-28 FASE 1).
//
// El smoke que faltaba. `smoke-bitacora-roles.mjs` prueba la ruta WEB
// (`crear_entrada_bitacora`), pero el bug de las bitácoras atascadas del ingeniero
// (20 y 25-ago, RLS) vivía en la ruta que usa la APP: `crear_bitacora_app` + la
// subida de fotos a Storage (bucket sgc-bitacora) que corre ANTES del RPC como el
// usuario plano. Ese camino nunca se smokeaba, y menos CONTRA EL ENTORNO REAL —
// por eso el bug "sobrevivió al fix". Regla BC7 ampliada: el smoke se corre contra
// el entorno que los usuarios usan, no solo local.
//
// Ejerce, por cada rol de campo (ingeniero_campo / ingeniero_oficina / capataz),
// EL FLUJO COMPLETO como el rol REAL (JWT simulado, rol authenticated):
//   1) INSERT en storage.objects del bucket sgc-bitacora (la subida de fotos),
//   2) `crear_bitacora_app` con 2 fotos + una actividad (ejerce bitacoras,
//      bitacora_actividades, bitacora_catalogo_usos, bitacora_archivos),
// y hace ROLLBACK — no deja datos. Falla con código !=0 si algún rol no puede
// completar el flujo (RLS/constraint/permiso).
//
// Uso:  node scripts/smoke-bitacora-app-prod.mjs
// Necesita SUPABASE_ACCESS_TOKEN. On-demand (necesita DB); no corre en prebuild.
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

const ROLES = ['ingeniero_campo', 'ingeniero_oficina', 'capataz'];

const usuarios = await q(`
  select distinct on (r.codigo) r.codigo as rol, u.id, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo in (${ROLES.map((r) => `'${r}'`).join(',')})
  order by r.codigo, u.nombre;
`);
const proy = await q(`
  select id from sgc.proyectos
  where coalesce(activo,true) and coalesce(es_prueba,false)=false
  order by created_at limit 1;`);
if (!proy?.[0]?.id) { console.error('No hay proyecto activo para el smoke'); process.exit(1); }
const proyectoId = proy[0].id;

let fallos = 0;
for (const rol of ROLES) {
  const u = usuarios.find((x) => x.rol === rol);
  if (!u) { console.log(`· ${rol}: (sin usuario asignado — se omite)`); continue; }
  const tag = `SMOKE_${rol}`;
  const acts = JSON.stringify([{ estructura: 'SMOKE_EST', actividad: 'SMOKE_ACT', cantidad: '3', unidad: 'und' }]).replace(/'/g, "''");
  const fotos = JSON.stringify([
    { nombre: 'f0.jpg', path: `${tag}/f0.jpg`, tipo_mime: 'image/jpeg' },
    { nombre: 'f1.jpg', path: `${tag}/f1.jpg`, tipo_mime: 'image/jpeg' },
  ]).replace(/'/g, "''");
  try {
    const r = await q(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', json_build_object('sub','${u.id}','role','authenticated')::text, true);
      -- (1) subida de fotos a Storage (el camino que reventaba con RLS)
      insert into storage.objects (bucket_id, name, owner, metadata) values
        ('sgc-bitacora','${tag}/f0.jpg','${u.id}','{}'::jsonb),
        ('sgc-bitacora','${tag}/f1.jpg','${u.id}','{}'::jsonb);
      -- (2) el RPC de la app con 2 fotos + actividad
      select sgc.crear_bitacora_app(
        p_id => gen_random_uuid(), p_proyecto_id => '${proyectoId}'::uuid,
        p_fecha => current_date, p_tipo => 'parte_diario', p_comentarios => 'SMOKE',
        p_actividades => '${acts}'::jsonb, p_fotos => '${fotos}'::jsonb,
        p_sin_actividad => false, p_horas_lluvia => null
      ) as id;
      rollback;
    `);
    const id = Array.isArray(r) ? r.find((x) => x?.id)?.id : null;
    if (id) console.log(`✓ ${rol} (${u.nombre}) — flujo app (storage + RPC + fotos) OK`);
    else { console.error(`✗ ${rol} (${u.nombre}) — sin id devuelto`); fallos++; }
  } catch (e) {
    console.error(`✗ ${rol} (${u.nombre}) — ${e.message}`);
    fallos++;
  }
}

if (fallos) { console.error(`\n🔴 Smoke bitácora APP (prod): ${fallos} rol(es) NO pueden completar el envío.`); process.exit(1); }
console.log('\n✓ Smoke bitácora APP (prod) OK — todos los roles de campo completan el flujo real (storage + RPC + fotos).');
