// gen-environment.mjs — BU1 F6 — genera src/environments/environment.ts (local,
// gitignored) para `ng serve`. Por defecto apunta a DEV (npm run env:dev).
// Toma la URL/anon del entorno pedido desde .env.local (SUPABASE_URL_<ENV>/ANON).
//   node scripts/gen-environment.mjs [dev|prod]   (default dev)
import './lib/load-env.mjs';
import { writeFileSync } from 'node:fs';

const target = (process.argv[2] || 'dev').toLowerCase();
const SUF = target.toUpperCase();
const url = process.env[`SUPABASE_URL_${SUF}`];
const anon = process.env[`SUPABASE_ANON_KEY_${SUF}`];
if (!url || !anon) { console.error(`faltan SUPABASE_URL_${SUF}/SUPABASE_ANON_KEY_${SUF} en .env.local`); process.exit(1); }

const appUrl = target === 'prod' ? 'https://sgcconstructorasd.com' : 'https://dev.sgcconstructorasd.com';
const content = `// GENERADO por scripts/gen-environment.mjs (npm run env:${target}) — NO COMMITEAR.
// Local ${target}. Regénéralo con: npm run env:${target}
export const environment = {
  production: false,
  entorno: '${target}',
  appUrl: '${appUrl}',
  supabaseUrl: '${url}',
  supabaseAnonKey: '${anon}',
};
`;
writeFileSync('src/environments/environment.ts', content);
console.log(`✓ environment.ts → ${target} (${url}) [gitignored]`);
