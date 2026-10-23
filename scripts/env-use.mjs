// env-use.mjs — cambia el destino de `ng serve` generando src/environments/environment.ts
// (gitignored) a partir de un archivo .env.<target>. Extiende `npm run env:dev` (que sigue igual).
//   node scripts/env-use.mjs dev             → sgc-dev (staging)               npm run env:dev-file
//   node scripts/env-use.mjs prod-readonly   → prod vía proxy SOLO LECTURA     npm run env:prod-ro  [--yes-prod]
// Cada target lee `.env.<target>` (gitignored; plantilla `.env.<target>.example`). Si falta un valor de
// dev/prod, se toma de src/environments/environment.<env>.ts (URL + anon key públicas, versionadas).
// Documentación: docs/ENTORNO-LOCAL.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  dev: { entorno: 'dev', remote: 'dev' },
  'prod-readonly': { entorno: 'prod', remote: 'prod' },
};
const PROXY_URL = 'http://127.0.0.1:54999'; // scripts/local/prod-readonly-proxy.mjs

const target = process.argv[2];
if (!TARGETS[target]) { console.error(`uso: node scripts/env-use.mjs ${Object.keys(TARGETS).join('|')} [--yes-prod]`); process.exit(1); }

function readEnvFile(name) {
  const file = join(ROOT, name);
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
function committedEnv(env) {
  const src = readFileSync(join(ROOT, `src/environments/environment.${env}.ts`), 'utf8');
  return { url: src.match(/supabaseUrl:\s*'([^']+)'/)?.[1], anon: src.match(/supabaseAnonKey:\s*'([^']+)'/)?.[1] };
}

const file = `.env.${target}`;
const cfg = readEnvFile(file);
let { SGC_SUPABASE_URL: url, SGC_SUPABASE_ANON_KEY: anon } = cfg;
const remote = TARGETS[target].remote;
if (remote && (!url || !anon)) { const c = committedEnv(remote); url ||= c.url; anon ||= c.anon; }
if (!url || !anon) { console.error(`faltan SGC_SUPABASE_URL/SGC_SUPABASE_ANON_KEY en ${file}`); process.exit(1); }

let appUrl = cfg.SGC_APP_URL || 'http://localhost:4200';
if (target === 'prod-readonly') {
  if (!process.argv.includes('--yes-prod')) {
    console.error('\n\x1b[41m\x1b[97m ▶ PRODUCCIÓN — SOLO LECTURA \x1b[0m');
    console.error('  Este target lee DATOS REALES de prod con tu sesión real. Las escrituras las bloquea un proxy local');
    console.error('  (npm run proxy:prod-ro), no la base. Repite con --yes-prod para confirmar.\n');
    process.exit(1);
  }
  url = PROXY_URL;
  console.error('\x1b[41m\x1b[97m ▶ PRODUCCIÓN SOLO LECTURA \x1b[0m  arranca el proxy en otra terminal: npm run proxy:prod-ro');
}

writeFileSync(join(ROOT, 'src/environments/environment.ts'), `// GENERADO por scripts/env-use.mjs (${target}) — NO COMMITEAR. Regénéralo con: npm run env:${{ dev: 'dev-file', 'prod-readonly': 'prod-ro' }[target]}
export const environment = {
  production: false,
  entorno: '${TARGETS[target].entorno}',
  appUrl: '${appUrl}',
  supabaseUrl: '${url}',
  supabaseAnonKey: '${anon}',
};
`);
console.log(`✓ environment.ts → ${target} (${url}) [gitignored]`);
