// scripts/data-fixes/2026-10-07-ci11-obra-demo.mjs — CI11 (regla 18/19)
// Crea/actualiza la OBRA DEMO + datos de prueba + los 2 usuarios revisores de tiendas.
// Todo es_prueba=true → el rol revisor_tiendas (política RESTRICTIVA revisor_solo_demo)
// solo ve esto, y el filtro AU18 ya lo excluye de KPIs/Seguimiento/notificaciones.
//
//   node scripts/data-fixes/2026-10-07-ci11-obra-demo.mjs --env dev
//   node scripts/data-fixes/2026-10-07-ci11-obra-demo.mjs --env prod   (solo tras OK en dev)
//
// Contraseñas: se generan y se escriben en .env.local (STORE_REVIEW_*). NO se imprimen.
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = await resolverEnv(process.argv.slice(2));
if (!env.serviceKey) {
  console.error(`🔴 Falta SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()} en .env.local`);
  process.exit(1);
}

const SUP = {
  supervisor: { email: 'revision.tiendas@constructorasd.com', nombre: 'Revisor de Tiendas (demo)', comparte: false },
  chofer:     { email: 'revision.chofer@constructorasd.com',  nombre: 'Chofer Demo (revisión)',    comparte: true  },
};

function genPassword() {
  // 24 chars, sin ambigüedad; fuerte y sin vencer.
  return 'Rv' + randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) + '7';
}

async function dbq(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return []; }
}

async function gotrue(path, method, body) {
  const res = await fetch(`${env.url}/auth/v1${path}`, {
    method,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

const Q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Usuario revisor: crea en Auth (o actualiza clave) + sgc.usuarios + rol ────────
async function upsertRevisor(key, rolId) {
  const u = SUP[key];
  const password = genPassword();
  // ¿Existe ya el perfil (y por tanto el usuario Auth, mismo id)?
  const prev = await dbq(`select id from sgc.usuarios where lower(email)=lower(${Q(u.email)}) limit 1`);
  let id = Array.isArray(prev) && prev[0] ? prev[0].id : null;

  if (id) {
    const r = await gotrue(`/admin/users/${id}`, 'PUT', { password, email_confirm: true });
    if (!r.ok) throw new Error(`No pude actualizar la clave de ${u.email}: ${r.text.slice(0, 200)}`);
  } else {
    const r = await gotrue('/admin/users', 'POST', { email: u.email, password, email_confirm: true });
    if (!r.ok) throw new Error(`No pude crear ${u.email}: ${r.text.slice(0, 200)}`);
    id = r.json?.id;
    if (!id) throw new Error(`Auth no devolvió id para ${u.email}`);
  }

  await dbq(`insert into sgc.usuarios (id, nombre, email, activo, es_prueba${u.comparte ? ', preferencias' : ''})
    values (${Q(id)}, ${Q(u.nombre)}, ${Q(u.email)}, true, true${u.comparte ? `, '{"comparte_ubicacion":true}'::jsonb` : ''})
    on conflict (id) do update set nombre=excluded.nombre, es_prueba=true, activo=true`);
  await dbq(`insert into sgc.usuarios_roles (usuario_id, rol_id) values (${Q(id)}, ${rolId})
    on conflict do nothing`);
  return { id, email: u.email, password };
}

async function main() {
  console.log(`\n▶ CI11 OBRA DEMO — entorno ${env.entorno} (${env.ref})\n`);

  const rol = await dbq(`select id from sgc.roles where codigo='revisor_tiendas' limit 1`);
  const rolId = Array.isArray(rol) && rol[0] ? rol[0].id : null;
  if (!rolId) throw new Error('Falta el rol revisor_tiendas. Aplica primero sql/2026-10-07-ci11-revisor-tiendas.sql');

  // 1) Usuarios revisores
  const supervisor = await upsertRevisor('supervisor', rolId);
  const chofer = await upsertRevisor('chofer', rolId);
  console.log('  ✓ usuarios revisores listos');

  // 2) OBRA DEMO
  await dbq(`insert into sgc.proyectos (codigo, nombre, es_prueba)
    values ('DEMO-001','OBRA DEMO — Residencial Ejemplo', true)
    on conflict (codigo) do update set nombre=excluded.nombre, es_prueba=true`);
  const pr = await dbq(`select id from sgc.proyectos where codigo='DEMO-001' limit 1`);
  const proyectoId = pr[0].id;
  console.log('  ✓ OBRA DEMO');

  // 3) Vehículo demo
  await dbq(`insert into sgc.vehiculos (placa, marca, modelo, anio, tipo, es_prueba, activo)
    values ('DEMO-001','Toyota','Hilux',2022,'camioneta', true, true)
    on conflict (placa) do update set es_prueba=true`);
  console.log('  ✓ vehículo DEMO-001');

  // 4) Conductor demo (ligado al usuario chofer)
  await dbq(`insert into sgc.conductores (usuario_id, nombre, cedula, licencia_tipo, es_prueba)
    select ${Q(chofer.id)}, 'Chofer Demo', '000-0000001-0', 'Categoría 3', true
    where not exists (select 1 from sgc.conductores where usuario_id=${Q(chofer.id)})`);
  console.log('  ✓ conductor demo');

  // 5) 5 personal de obra ficticio (cédulas inválidas 000-000000x-0)
  for (let i = 1; i <= 5; i++) {
    await dbq(`insert into sgc.personal_obra (proyecto_id, nombre, es_prueba)
      select ${Q(proyectoId)}, ${Q('Trabajador Demo ' + i)}, true
      where not exists (select 1 from sgc.personal_obra where proyecto_id=${Q(proyectoId)} and nombre=${Q('Trabajador Demo ' + i)})`);
  }
  console.log('  ✓ 5 personal de obra');

  // 6) 3 bitácoras demo
  for (let i = 0; i < 3; i++) {
    await dbq(`insert into sgc.bitacoras (usuario_id, proyecto_id, fecha, es_prueba)
      select ${Q(supervisor.id)}, ${Q(proyectoId)}, current_date - ${i}, true
      where not exists (select 1 from sgc.bitacoras where proyecto_id=${Q(proyectoId)} and fecha=current_date - ${i} and es_prueba)`);
  }
  console.log('  ✓ 3 bitácoras');

  // 7) 2 conduces externos demo (best-effort; placa_foto_path requerido)
  try {
    for (let i = 1; i <= 2; i++) {
      await dbq(`insert into sgc.conduces_externos (placa_foto_path, emisor_usuario_id, creado_por, es_prueba)
        select ${Q('demo/placa-' + i + '.jpg')}, ${Q(supervisor.id)}, ${Q(supervisor.id)}, true
        where not exists (select 1 from sgc.conduces_externos where placa_foto_path=${Q('demo/placa-' + i + '.jpg')})`);
    }
    console.log('  ✓ 2 conduces externos');
  } catch (e) {
    console.log(`  ⚠️ conduces externos omitidos (esquema): ${String(e.message).slice(0, 120)}`);
  }

  // 8) Guardar credenciales en .env.local (NO imprimir)
  const envPath = '.env.local';
  let body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const sets = {
    [`STORE_REVIEW_SUPERVISOR_EMAIL_${env.entorno.toUpperCase()}`]: supervisor.email,
    [`STORE_REVIEW_SUPERVISOR_PASSWORD_${env.entorno.toUpperCase()}`]: supervisor.password,
    [`STORE_REVIEW_CHOFER_EMAIL_${env.entorno.toUpperCase()}`]: chofer.email,
    [`STORE_REVIEW_CHOFER_PASSWORD_${env.entorno.toUpperCase()}`]: chofer.password,
  };
  for (const [k, v] of Object.entries(sets)) {
    const line = `${k}=${v}`;
    body = new RegExp(`^${k}=.*$`, 'm').test(body) ? body.replace(new RegExp(`^${k}=.*$`, 'm'), line) : (body.trimEnd() + '\n' + line + '\n');
  }
  writeFileSync(envPath, body);
  console.log(`\n  ✓ credenciales escritas en ${envPath} (STORE_REVIEW_*_${env.entorno.toUpperCase()}). NO se imprimen aquí.`);
  console.log('\n✅ OBRA DEMO lista. Pásale a Xaviel las credenciales desde .env.local para las consolas.\n');
}

main().catch((e) => { console.error(`\n🔴 ${e.message}\n`); process.exit(1); });
