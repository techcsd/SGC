/**
 * DP-13d (CONTEXTO-72) — smoke de idioma con Playwright. Inicia sesión (misma
 * cuenta QA de dev usada por qa/visual/capturar.mjs), cambia a `en` y a `ht`,
 * recorre las rutas marcadas `enforce:true` en alcance.json (las únicas que
 * HOY están 100% cableadas — recorrer el resto daría falsos positivos) y
 * falla si:
 *   (a) el `<html lang>` no coincide con el idioma elegido, o
 *   (b) `I18nService.t()` registró una clave sin traducir (dev-miss logging,
 *       DP-07b) — se captura por consola, el pipe `t` corre con
 *       `!environment.production` en local/dev.
 *
 * USO:  npm run i18n:smoke  (requiere el dev server corriendo: npm start)
 * No se agrega al prebuild (puede tardar); se corre a mano o en release-check.
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = process.env.SGC_QA_BASE || 'http://localhost:4200';
const AUTH_STATE = join(ROOT, 'qa', 'visual', '.auth.json');

const ALCANCE = JSON.parse(readFileSync(join(ROOT, 'src', 'app', 'core', 'i18n', 'alcance.json'), 'utf8'));
// Mapa pantalla → ruta real a visitar (algunas pantallas medidas por el
// escáner viven EMBEBIDAS dentro de otra ruta, no tienen URL propia).
const RUTA_REAL = {
  'configuracion/claude': 'claude', // embebida en Claude › Inicio
  'admin/claude': 'claude', // embebida en Claude › Auditoría › Conexiones
  'ajustes-notificaciones': 'configuracion#notificaciones', // embebida en Configuración
  'inventario/por-firmar': 'por-firmar', // AU8 — ruta top-level, no /inventario/por-firmar
  'inventario/conduce-externo-form': 'inventario/conduce-externo/nuevo',
  'inventario/conduce-externo-ficha': null, // ruta dinámica (:id) — sin URL genérica, se salta
};
const RUTAS_ENFORCE = Object.entries(ALCANCE.pantallas ?? {})
  .filter(([, v]) => v?.enforce)
  .map(([pant]) => pant)
  .filter((p) => RUTA_REAL[p] !== null); // null = ruta dinámica sin URL genérica, se salta
const RUTAS = [...new Set(RUTAS_ENFORCE.map((p) => RUTA_REAL[p] ?? p))];

async function dismissOverlays(page) {
  for (const texto of ['Acepto', 'Entendido']) {
    const btn = page.getByRole('button', { name: texto, exact: true });
    if (await btn.count().catch(() => 0)) {
      await btn.first().click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

async function ensureAuth(browser) {
  if (existsSync(AUTH_STATE)) return browser.newContext({ storageState: AUTH_STATE });
  const email = process.env.SGC_QA_EMAIL;
  const pass = process.env.SGC_QA_PASSWORD;
  if (!email || !pass) {
    console.error('✗ i18n-smoke: sin sesión (ni qa/visual/.auth.json ni SGC_QA_EMAIL/PASSWORD).');
    process.exit(1);
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"], input[autocomplete="username"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissOverlays(page);
  await ctx.storageState({ path: AUTH_STATE });
  await page.close();
  return ctx;
}

(async () => {
  if (!RUTAS.length) {
    console.log('[i18n-smoke] ninguna pantalla enforce:true todavía — nada que recorrer.');
    process.exit(0);
  }
  const browser = await chromium.launch();
  const ctx = await ensureAuth(browser);
  const page = await ctx.newPage();

  const misses = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('[i18n] sin traducción')) misses.push(msg.text());
  });

  // El idioma es canónico en el SERVIDOR (usuarios.idioma): escribir solo
  // localStorage no alcanza, adoptFromServer() lo pisa de vuelta al cargar el
  // perfil. Hay que cambiarlo por la UI real (setIdioma() también persiste).
  const NOMBRE_NATIVO = { en: 'English', ht: 'Kreyòl ayisyen' };
  async function cambiarIdiomaPorUi(idioma) {
    await page.goto(`${BASE}/configuracion#idioma`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    // `/configuracion` lee el fragmento SOLO en ngOnInit — si la navegación
    // previa terminó en la MISMA ruta (p. ej. /perfil redirige a
    // /configuracion#cuenta), un cambio de fragmento a secas no re-dispara
    // ngOnInit y la sección "idioma" nunca se muestra. Forzar un reload
    // real garantiza que siempre se lea el fragmento actual.
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await dismissOverlays(page);
    await page.getByRole('button', { name: new RegExp(NOMBRE_NATIVO[idioma]) }).first().click({ timeout: 10000 });
    await page.waitForTimeout(800); // setIdioma() es async (RPC + catálogo)
  }

  let fallos = 0;
  for (const idioma of ['en', 'ht']) {
    await cambiarIdiomaPorUi(idioma);

    for (const ruta of RUTAS) {
      misses.length = 0;
      await page.goto(`${BASE}/${ruta}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await dismissOverlays(page);
      await page.waitForTimeout(600);

      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      if (htmlLang !== idioma) {
        console.error(`✗ ${ruta} [${idioma}]: <html lang> es "${htmlLang}", esperaba "${idioma}"`);
        fallos++;
      }
      if (misses.length) {
        console.error(`✗ ${ruta} [${idioma}]: ${misses.length} clave(s) sin traducir: ${misses.slice(0, 5).join(' · ')}`);
        fallos++;
      } else {
        console.log(`  ✓ ${ruta} [${idioma}]`);
      }
    }
  }

  await browser.close();
  if (fallos) {
    console.error(`\n✗ i18n-smoke: ${fallos} fallo(s).`);
    process.exit(1);
  }
  console.log(`\n✓ i18n-smoke: ${RUTAS.length} pantalla(s) × 2 idiomas, sin fallos.`);
})();
