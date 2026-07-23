// ============================================================================
// R14 — Usuarios de prueba por rol (QA de alcance de datos por rol).
// ----------------------------------------------------------------------------
// Cierra el único punto que faltaba del workstream de roles (R14): el enforcement
// (RLS scoping + guards + UI + dashboard segmentado) YA está; faltaba un seed que
// cree UN usuario de prueba por rol para ejecutar la checklist de QA por rol
// (ver QA-ROLES-CHECKLIST.md).
//
// Crea (idempotente) un usuario auth por cada rol de sgc.roles:
//   email:    qa-<codigo>@prueba.constructorasd.local
//   password: (una sola, compartida — solo QA; se imprime al final)
//   perfil:   sgc.usuarios (nombre "QA · <nombre> [PRUEBA]", activo=true)
//   rol:      sgc.usuarios_roles (rol_id del rol)
// Usa createUser + email_confirm (NO invita por correo: el dominio es falso).
// Marca cada uno en user_metadata.qa=true para poder barrerlos/eliminarlos.
//
// SEGURIDAD: crea CUENTAS REALES que pueden iniciar sesión en producción.
// Ejecutar solo con intención de QA. Para limpiarlos: `node seed-usuarios-prueba.mjs --purge`.
//
// Requisitos de entorno (NO se commitean; ponerlos en .env.local o el shell):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (opcional) QA_TEST_PASSWORD  — default 'QaPrueba-2026!' si no se define.
//
// Uso:
//   node scripts/seed-usuarios-prueba.mjs           # crea/asegura los usuarios
//   node scripts/seed-usuarios-prueba.mjs --purge    # elimina los usuarios QA
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.QA_TEST_PASSWORD || 'QaPrueba-2026!';
const PURGE = process.argv.includes('--purge');
const DOMAIN = 'prueba.constructorasd.local';

if (!URL || !SRK) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Ponlos en .env.local o expórtalos y vuelve a correr el script.');
  process.exit(1);
}

const admin = createClient(URL, SRK, { db: { schema: 'sgc' }, auth: { persistSession: false } });

// Busca un usuario auth por email paginando la lista de admin (no hay getByEmail).
async function findAuthUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
}

async function main() {
  const { data: roles, error: rolesErr } = await admin.from('roles').select('id, codigo, nombre').order('nombre');
  if (rolesErr) throw new Error('No se pudieron leer los roles: ' + rolesErr.message);
  if (!roles?.length) throw new Error('sgc.roles está vacío.');

  const results = [];

  for (const rol of roles) {
    const email = `qa-${rol.codigo}@${DOMAIN}`;
    const existing = await findAuthUserByEmail(email);

    if (PURGE) {
      if (existing) {
        await admin.from('usuarios_roles').delete().eq('usuario_id', existing.id);
        await admin.from('usuarios').delete().eq('id', existing.id);
        await admin.auth.admin.deleteUser(existing.id);
        results.push({ rol: rol.codigo, email, estado: 'ELIMINADO' });
      } else {
        results.push({ rol: rol.codigo, email, estado: 'no existía' });
      }
      continue;
    }

    let userId = existing?.id;
    if (!userId) {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { nombre: `QA · ${rol.nombre} [PRUEBA]`, qa: true },
      });
      if (cErr || !created?.user) { results.push({ rol: rol.codigo, email, estado: 'ERROR auth: ' + (cErr?.message ?? '?') }); continue; }
      userId = created.user.id;
    }

    // Perfil (upsert idempotente).
    const { error: pErr } = await admin
      .from('usuarios')
      .upsert({ id: userId, nombre: `QA · ${rol.nombre} [PRUEBA]`, email, activo: true }, { onConflict: 'id' });
    if (pErr) { results.push({ rol: rol.codigo, email, estado: 'ERROR perfil: ' + pErr.message }); continue; }

    // Rol (evita duplicar la asignación).
    const { data: yaTiene } = await admin
      .from('usuarios_roles').select('usuario_id').eq('usuario_id', userId).eq('rol_id', rol.id).maybeSingle();
    if (!yaTiene) {
      const { error: rErr } = await admin.from('usuarios_roles').insert({ usuario_id: userId, rol_id: rol.id });
      if (rErr) { results.push({ rol: rol.codigo, email, estado: 'ERROR rol: ' + rErr.message }); continue; }
    }

    results.push({ rol: rol.codigo, email, estado: existing ? 'ya existía (actualizado)' : 'CREADO' });
  }

  console.table(results);
  if (!PURGE) {
    console.log(`\n${results.filter((r) => r.estado === 'CREADO').length} creados · contraseña compartida: ${PASSWORD}`);
    console.log('Inicia sesión con cualquiera de esos correos + esa contraseña para QA por rol.');
    console.log('Para limpiarlos al terminar: node scripts/seed-usuarios-prueba.mjs --purge');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
