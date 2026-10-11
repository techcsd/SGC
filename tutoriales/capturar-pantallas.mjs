// SGC motion — captura pantallas reales (dev, usuario demo) para el promo Remotion.
// Solo dev + usuario demo (candado de privacidad). Guarda PNG 1920x1080 en motion/public/shots/.
//
//   node capturar-pantallas.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDev, assertTextoLimpio } from './lib/privacy-lock.mjs';
import { dismissModales } from './lib/record.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(AQUI, 'motion', 'public', 'shots');
mkdirSync(OUT, { recursive: true });

const DEMO = { cedulas: ['000-0000000-0'], placas: ['DEMO-001', 'DEMO-002', 'DEMO-003'] };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function env() {
  const e = {};
  for (const l of readFileSync(resolve(AQUI, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return e;
}

// Pantallas candidatas (se saltan las que den 403/redirijan a auth).
const TARGETS = [
  { name: 'dashboard', path: 'dashboard' },
  { name: 'inventario', path: 'inventario' },
  { name: 'conduces', path: 'transporte/trabajos' },
  { name: 'flota', path: 'flota' },
  { name: 'tareas', path: 'tareas' },
  { name: 'mensajeria', path: 'mensajes' },
  { name: 'proyectos', path: 'proyectos' },
  { name: 'bitacora', path: 'bitacora' },
];

const web = process.env.TUTORIAL_WEB_URL || 'http://localhost:4200';
assertDev(web);
const E = env();
const email = E.STORE_REVIEW_SUPERVISOR_EMAIL_DEV, pass = E.STORE_REVIEW_SUPERVISOR_PASSWORD_DEV;
if (!email || !pass) throw new Error('Faltan STORE_REVIEW_SUPERVISOR_*_DEV en ../.env.local');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'es-DO' });
const page = await ctx.newPage();

try {
  await page.goto(`${web}/auth`, { waitUntil: 'networkidle', timeout: 45000 });
  const conCorreo = page.getByRole('button', { name: /Con correo/i });
  if (await conCorreo.count()) await conCorreo.first().click().catch(() => {});
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(pass);
  await page.getByRole('button', { name: /Iniciar sesión/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 45000 }).catch(() => {});
  await pausa(1800);
  await dismissModales(page);

  const hechas = [];
  for (const t of TARGETS) {
    try {
      await page.goto(`${web}/${t.path}`, { waitUntil: 'networkidle', timeout: 40000 });
      await pausa(1600);
      await dismissModales(page);
      await pausa(600);
      const u = new URL(page.url());
      if (u.pathname.includes('/403') || u.pathname.startsWith('/auth')) { console.log(`· ${t.name}: sin acceso (${u.pathname}) — salto`); continue; }
      assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);
      await page.screenshot({ path: resolve(OUT, `${t.name}.png`) });
      hechas.push(t.name);
      console.log(`✓ ${t.name}.png`);
    } catch (e) { console.log(`✗ ${t.name}: ${e.message.split('\n')[0]}`); }
  }
  console.log(`\nCapturas OK: ${hechas.join(', ') || '(ninguna)'}`);
} finally {
  await ctx.close();
  await browser.close();
}
