// aplicar-hook-dev.mjs — CC2 — activa el Custom Access Token hook en sgc-dev.
// El hook `sgc.dev_token_hook` niega el token a quien no esté autorizado en dev.
//
//   node scripts/aplicar-hook-dev.mjs --env dev
//
// SOLO dev: rechaza --env prod (el candado de dev no existe en prod).
import { resolverEnv } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') {
  console.error('🔴 aplicar-hook-dev SOLO corre con --env dev (el hook de dev no va a prod).');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hook_custom_access_token_enabled: true,
    hook_custom_access_token_uri: 'pg-functions://postgres/sgc/dev_token_hook',
  }),
});
if (!res.ok) {
  console.error(`🔴 HTTP ${res.status}: ${await res.text()}`);
  console.error('Si la API no lo permite, actívalo a mano: Dashboard → Authentication → Hooks →');
  console.error('  Customize Access Token (JWT) Claims → sgc.dev_token_hook. Ver docs/ENTORNOS.md.');
  process.exit(1);
}
const j = await res.json();
console.log(`✓ Hook activo en dev (${env.ref}): ${j.hook_custom_access_token_enabled} → ${j.hook_custom_access_token_uri}`);
