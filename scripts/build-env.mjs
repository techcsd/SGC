// build-env.mjs — BU1 F6 — elige la configuración de build por entorno y construye.
// Vercel: VERCEL_ENV=production → prod ; preview → dev. Local: SGC_ENV=dev|prod.
// Copia environment.<target>.ts → environment.ts (para que la resolución de módulos
// funcione en CI sin .env.local) y corre `ng build --configuration <target>`.
import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const argEnv = (() => { const i = process.argv.indexOf('--env'); return i !== -1 ? process.argv[i + 1] : null; })();
const vercel = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
const sgc = process.env.SGC_ENV;       // override local
let target = 'prod';
if (argEnv === 'dev' || argEnv === 'prod') target = argEnv;
else if (sgc === 'dev' || sgc === 'prod') target = sgc;
else if (vercel === 'preview') target = 'dev';
else if (vercel === 'production') target = 'prod';

const src = `src/environments/environment.${target}.ts`;
if (!existsSync(src)) { console.error(`no existe ${src}`); process.exit(1); }
copyFileSync(src, 'src/environments/environment.ts');
const config = target === 'dev' ? 'dev' : 'production';
console.log(`▶ build ${target} (ng build --configuration ${config})`);
// Vercel llama a este script como buildCommand (salta el ciclo npm), así que
// corremos aquí la cadena completa: guards (prebuild) → build → registro (postbuild).
execSync('npm run prebuild', { stdio: 'inherit' });
execSync(`npx ng build --configuration ${config}`, { stdio: 'inherit' });
try { execSync('node scripts/registrar-version-web.mjs', { stdio: 'inherit' }); } catch { /* red de seguridad: autoRegistrarVersionWeb */ }
