// dev-set-password.mjs — CC2 — fija una contraseña de DEV a un correo real y lo
// mete en la lista blanca (dev_acceso) para que el hook lo deje entrar.
//
//   node scripts/dev-set-password.mjs --env dev --email tecnologia@constructorasd.com
//   node scripts/dev-set-password.mjs --env dev --email x@y.com --password "MiClave123"
//
// SOLO dev: se niega con --env prod. Imprime la contraseña UNA vez.
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') {
  console.error('🔴 dev-set-password SOLO corre con --env dev (nunca fija contraseñas en prod).');
  process.exit(1);
}
const emailArg = (() => { const i = argv.indexOf('--email'); return i >= 0 ? argv[i + 1] : null; })();
if (!emailArg) { console.error('Falta --email <correo>'); process.exit(1); }
const email = emailArg.toLowerCase().trim();
const pwArg = (() => { const i = argv.indexOf('--password'); return i >= 0 ? argv[i + 1] : null; })();

if (!env.serviceKey) { console.error('🔴 Falta SUPABASE_SERVICE_ROLE_KEY_DEV en .env.local'); process.exit(1); }

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const arr = new Uint32Array(15);
  crypto.getRandomValues(arr);
  const body = Array.from(arr.slice(0, 13), (n) => chars[n % chars.length]).join('');
  return `${body}${nums[arr[13] % nums.length]}${nums[arr[14] % nums.length]}`;
}
const password = pwArg || genPassword();
if (password.length < 10 || !/[0-9]/.test(password)) {
  console.error('🔴 La contraseña debe tener ≥ 10 caracteres e incluir un número.');
  process.exit(1);
}

// 1) id del usuario en Auth (por email).
const rows = await dbQuery(env, `select id::text from auth.users where lower(email) = '${email.replace(/'/g, "''")}' limit 1`);
if (!Array.isArray(rows) || !rows[0]?.id) {
  console.error(`🔴 No existe un usuario Auth con el correo ${email} en dev. ¿Corriste el seed?`);
  process.exit(1);
}
const uid = rows[0].id;

// 2) Fijar la contraseña vía GoTrue Admin API (service role).
const res = await fetch(`${env.url}/auth/v1/admin/users/${uid}`, {
  method: 'PUT',
  headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password, email_confirm: true }),
});
if (!res.ok) { console.error(`🔴 HTTP ${res.status}: ${await res.text()}`); process.exit(1); }

// 3) Asegurar que el correo está en la lista blanca de dev (si no es qa_/sintético).
if (!email.startsWith('qa_') && !email.endsWith('.local')) {
  await dbQuery(env, `insert into sgc.dev_acceso (email, nota) values ('${email.replace(/'/g, "''")}', 'dev-set-password') on conflict (email) do nothing`);
}

console.log(`\n✓ Contraseña de DEV fijada para ${email} (${env.ref})`);
console.log(`  y añadido a la lista blanca dev_acceso.\n`);
console.log(`  Contraseña (se muestra UNA vez): ${password}\n`);
