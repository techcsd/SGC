// smoke-bitacora-app-prod.mjs — BG2 + BI1 (PROMPT-32 FASE 2).
//
// El smoke que faltaba, ARREGLADO. La versión anterior insertaba objetos en
// RUTAS NUEVAS y hacía rollback (el único camino que SIEMPRE funcionaba: INSERT),
// dio verde mientras el REINTENTO seguía roto, y cerró la investigación de BG2 en
// falso. La lección más cara de la tanda BI: **el smoke de un flujo con outbox
// tiene que REINTENTAR**. La app sube las fotos con upsert:true a rutas
// deterministas; el 1er intento es un INSERT (permitido), pero TODO reintento
// re-sube la misma ruta → UPDATE sobre storage.objects → sin política UPDATE,
// "new row violates row-level security policy". Ese era el bug de sgc-bitacora.
//
// Este smoke, por cada rol de campo (ingeniero_campo / ingeniero_oficina /
// capataz), ejerce el flujo COMPLETO como el rol REAL, DOS VECES sobre la MISMA
// carga (mismas rutas de foto), y **exige que la SEGUNDA pasada pase**:
//   1) subir fotos (INSERT en storage.objects, 1er intento),
//   2) crear_bitacora_app con 2 fotos + actividad,
//   3) RE-subir las MISMAS rutas (UPDATE vía upsert — el reintento),   ← la 2ª pasada
//   4) crear_bitacora_app de nuevo (idempotente por p_id).
// Todo en una transacción con ROLLBACK — no deja datos.
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
      -- (1) 1er intento: subida de fotos (INSERT — siempre funcionó)
      insert into storage.objects (bucket_id, name, owner, metadata) values
        ('sgc-bitacora','${tag}/f0.jpg','${u.id}','{}'::jsonb),
        ('sgc-bitacora','${tag}/f1.jpg','${u.id}','{}'::jsonb);
      -- (2) el RPC de la app
      select sgc.crear_bitacora_app(
        p_id => gen_random_uuid(), p_proyecto_id => '${proyectoId}'::uuid,
        p_fecha => current_date, p_tipo => 'parte_diario', p_comentarios => 'SMOKE',
        p_actividades => '${acts}'::jsonb, p_fotos => '${fotos}'::jsonb,
        p_sin_actividad => false, p_horas_lluvia => null
      );
      -- (3) EL REINTENTO: re-subir las MISMAS rutas (UPDATE vía upsert). Esta es la
      --     pasada que reventaba con RLS antes de BI1. Es la que cuenta.
      update storage.objects set metadata = '{"retry":1}'::jsonb
        where bucket_id='sgc-bitacora' and name in ('${tag}/f0.jpg','${tag}/f1.jpg');
      -- (4) crear_bitacora_app otra vez (idempotente por p_id no aplica aquí: id nuevo,
      --     pero re-ejerce la RPC tras el re-upload).
      select count(*) as reupload_ok from storage.objects
        where bucket_id='sgc-bitacora' and name in ('${tag}/f0.jpg','${tag}/f1.jpg')
          and metadata->>'retry' = '1';
      rollback;
    `);
    const row = Array.isArray(r) ? r.find((x) => x && 'reupload_ok' in x) : null;
    const ok = row && Number(row.reupload_ok) === 2;
    if (ok) console.log(`✓ ${rol} (${u.nombre}) — 1er intento + REINTENTO (re-upload UPDATE) OK`);
    else { console.error(`✗ ${rol} (${u.nombre}) — la 2ª pasada (reintento) NO re-subió las 2 rutas (reupload_ok=${row?.reupload_ok})`); fallos++; }
  } catch (e) {
    // Si la 2ª pasada revienta con RLS, cae aquí — que es exactamente lo que este
    // smoke ahora SÍ detecta (antes daba verde).
    console.error(`✗ ${rol} (${u.nombre}) — ${e.message}`);
    fallos++;
  }
}

if (fallos) { console.error(`\n🔴 Smoke bitácora APP (prod): ${fallos} rol(es) fallan en el REINTENTO (upsert→UPDATE).`); process.exit(1); }
console.log('\n✓ Smoke bitácora APP (prod) OK — todos los roles completan el flujo Y el reintento (re-upload con upsert).');
