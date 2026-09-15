// crear-usuario-flaco.mjs — BR8 (PROMPT-52 F2).
//
// Crea el usuario de "El flaco" (Encargado de Patio y Bodega Central) con acceso por
// cédula + PIN, le asigna el rol encargado_patio y lo pone como encargado de la
// Bodega Central. DEFAULTS (CONTEXTO-25 §E): nombre "El Flaco — Encargado de Patio",
// acceso cédula+PIN, PIN temporal aleatorio (se imprime — Xaviel se lo da en persona,
// NUNCA por correo), encargado de la bodega es_central.
//
// Usa el service_role (GoTrue admin) para no depender de un JWT de admin. Espeja lo
// que hace la edge acceso-cedula (tipo 'encargado', dominio @acceso.constructorasd.local
// para que el trigger de conductores NO le fabrique ficha — regla 13).
//
// Requiere en el entorno: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
// Uso:  node scripts/crear-usuario-flaco.mjs [cedula]
//   - cedula opcional; si no se pasa, usa 00000000000 provisional (Xaviel la corrige
//     luego en Admin › Usuarios). El PIN temporal se genera y se imprime.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.'); process.exit(1); }

const NOMBRE = 'El Flaco — Encargado de Patio';
const cedula = (process.argv[2] || '00000000000').replace(/\D/g, '');
const dominio = '@acceso.constructorasd.local';
const email = `e-${cedula}${dominio}`;

// PIN de 6 dígitos no trivial.
function genPin() {
  for (;;) {
    const p = String(Math.floor(100000 + Math.random() * 900000));
    if (/^(\d)\1{5}$/.test(p)) continue;
    if (cedula.includes(p)) continue;
    let asc = true, desc = true;
    for (let i = 1; i < 6; i++) { const d = p.charCodeAt(i) - p.charCodeAt(i - 1); if (d !== 1) asc = false; if (d !== -1) desc = false; }
    if (asc || desc) continue;
    return p;
  }
}
const pin = genPin();

const admin = createClient(url, key, { db: { schema: 'sgc' }, auth: { persistSession: false } });

const { data: dup } = await admin.from('usuarios').select('id,nombre').or(`cedula.eq.${cedula},email.eq.${email}`).maybeSingle();
if (dup?.id) { console.error(`Ya existe un usuario con esa cédula/email: "${dup.nombre}" (${dup.id}). Usa "Fijar PIN" en su ficha.`); process.exit(1); }

const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email, password: pin, email_confirm: true,
  user_metadata: { nombre: NOMBRE, acceso_cedula: true, rol_tipo: 'encargado' },
});
if (cErr || !created?.user) { console.error('No se pudo crear el auth user:', cErr?.message); process.exit(1); }
const uid = created.user.id;

const { error: pErr } = await admin.from('usuarios').insert({ id: uid, nombre: NOMBRE, email, cedula, activo: true, es_prueba: false });
if (pErr) { await admin.auth.admin.deleteUser(uid); console.error('No se pudo crear el perfil:', pErr.message); process.exit(1); }

const { data: rol } = await admin.from('roles').select('id').eq('codigo', 'encargado_patio').maybeSingle();
if (!rol?.id) { console.error('No existe el rol encargado_patio.'); process.exit(1); }
await admin.from('usuarios_roles').upsert({ usuario_id: uid, rol_id: rol.id }, { onConflict: 'usuario_id,rol_id', ignoreDuplicates: true });

const { error: bErr } = await admin.from('bodegas').update({ encargado_id: uid }).eq('es_central', true);
if (bErr) console.warn('Aviso: no se pudo asignar encargado de la Bodega Central:', bErr.message);

console.log('✓ Usuario de El flaco creado.');
console.log('  id     :', uid);
console.log('  nombre :', NOMBRE, '(renómbralo con su nombre real en Admin › Usuarios)');
console.log('  cédula :', cedula, cedula === '00000000000' ? '(PROVISIONAL — corrígela)' : '');
console.log('  email  :', email);
console.log('  PIN    :', pin, '  ← entrégaselo en persona, NUNCA por correo');
console.log('  rol    : encargado_patio · encargado de la Bodega Central');
