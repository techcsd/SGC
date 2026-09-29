// qa/visual/capturar.mjs — CB v2. Recorre las rutas de la web y toma capturas
// claro+oscuro, escritorio (1440×900) y móvil (390×844) para el QA visual del
// rediseño (antes/después). Idea: `node qa/visual/capturar.mjs antes` antes de
// tocar nada, `… despues` al terminar cada fase; el índice (indice.mjs) las cruza.
//
// AUTENTICACIÓN (casi todo vive detrás del authGuard):
//   1) Si existe `qa/visual/.auth.json` (storageState de Playwright) se usa.
//      Para generarlo, Xaviel entra una vez:  node qa/visual/login.mjs
//   2) Si están SGC_QA_EMAIL + SGC_QA_PASSWORD en el entorno, hace login solo.
//   3) Si no hay ninguno, captura SOLO las rutas públicas (/auth, /auth/set-password)
//      y avisa — el resto necesita sesión.
//
// USO:  node qa/visual/capturar.mjs <label> [--rutas ruta1,ruta2] [--base http://localhost:4200]
//
// Requiere el dev server corriendo (npm start) o una URL de preview de Vercel.

import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) || 'captura';
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const BASE = flag('base') || process.env.SGC_QA_BASE || 'http://localhost:4200';
const AUTH_STATE = join(__dirname, '.auth.json');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'movil', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

// ── Lista de rutas ────────────────────────────────────────────────────────────
// De un --rutas explícito, o de qa/visual/rutas.json, o extraídas de app.routes.ts.
function rutasDeCodigo() {
  const src = readFileSync(join(ROOT, 'src', 'app', 'app.routes.ts'), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/path:\s*'([^']*)'/g)) {
    const p = m[1];
    if (!p || p === '**' || p.includes(':') || p.startsWith('auth')) continue;
    out.add(p);
  }
  return [...out];
}
function listaRutas() {
  const explicit = flag('rutas');
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean);
  const file = join(__dirname, 'rutas.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  return rutasDeCodigo();
}

const PUBLICAS = ['auth', 'auth/set-password'];

async function ensureAuth(browser) {
  if (existsSync(AUTH_STATE)) {
    console.log('[capturar] usando sesión guardada qa/visual/.auth.json');
    return await browser.newContext({ storageState: AUTH_STATE });
  }
  const email = process.env.SGC_QA_EMAIL;
  const pass = process.env.SGC_QA_PASSWORD;
  if (email && pass) {
    console.log(`[capturar] login con SGC_QA_EMAIL (${email})…`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"], input[autocomplete="username"]', email);
    await page.fill('input[type="password"]', pass);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 }).catch(() => {});
    await ctx.storageState({ path: AUTH_STATE });
    await page.close();
    return ctx;
  }
  console.warn('[capturar] ⚠ sin sesión (ni .auth.json ni SGC_QA_EMAIL/PASSWORD): solo rutas públicas.');
  return null;
}

async function shoot(page, ruta, viewport, theme, dir) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Fija el tema antes de cargar (BE6 lee usuario_preferencias.tema; aquí forzamos
  // el atributo directamente para no depender del backend).
  await page.addInitScript((t) => {
    try { localStorage.setItem('sgc-tema', t); } catch {}
  }, theme);
  const url = `${BASE}/${ruta}`.replace(/\/+$/, '') || BASE;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : ''), theme);
  await page.waitForTimeout(500); // asentar fuentes/animaciones
  const safe = (ruta || 'home').replace(/[\/:*?"<>|]+/g, '_') || 'home';
  const out = join(dir, `${safe}__${viewport.name}__${theme}.png`);
  await page.screenshot({ path: out, fullPage: true }).catch((e) => console.warn(`   ✗ ${safe} ${viewport.name}/${theme}: ${e.message}`));
}

(async () => {
  const rutas = listaRutas();
  const outDir = join(__dirname, 'cb', label);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const authed = await ensureAuth(browser);
  const rutasAUsar = authed ? [...PUBLICAS, ...rutas] : PUBLICAS;

  console.log(`[capturar] ${rutasAUsar.length} ruta(s) × ${VIEWPORTS.length} viewport × ${THEMES.length} tema → ${outDir}`);
  const ctx = authed || (await browser.newContext());
  const page = await ctx.newPage();

  let n = 0;
  for (const ruta of rutasAUsar) {
    for (const vp of VIEWPORTS) {
      for (const th of THEMES) {
        await shoot(page, ruta, vp, th, outDir);
        n++;
      }
    }
    console.log(`  ✓ ${ruta}`);
  }

  const manifest = { label, base: BASE, generado: label, rutas: rutasAUsar, viewports: VIEWPORTS, temas: THEMES, total: n };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`[capturar] listo: ${n} capturas en ${outDir}`);
})();
