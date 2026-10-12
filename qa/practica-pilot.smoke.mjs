// qa/practica-pilot.smoke.mjs — smoke del piloto CM7 "Crear una requisición".
// Navega a /practica, entra a la misión (pantalla real), y verifica que la banda de
// práctica sale, la obra tiene opciones demo y se puede agregar material. Screenshots.
//   node qa/practica-pilot.smoke.mjs [--base http://localhost:4200]
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bi = args.indexOf('--base');
const BASE = bi >= 0 ? args[bi + 1] : 'http://localhost:4200';
const AUTH = join(__dirname, 'visual', '.auth.json');
const OUT = join(__dirname, 'practica-smoke');

const log = (...a) => console.log('·', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: existsSync(AUTH) ? AUTH : undefined,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

  const login = async () => {
    await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 60000 });
    const email = process.env.SGC_QA_EMAIL ;
    const pass = process.env.SGC_QA_PASSWORD ;
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(pass);
    await page.locator('#password').press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 }).catch(() => {});
    const err = await page.locator('.field-error, .error-state, [role="alert"], .toast').first().textContent().catch(() => '');
    log('login → url:', page.url(), err ? `(msg: ${err.trim().slice(0, 80)})` : '');
  };

  try {
    await page.goto(`${BASE}/practica`, { waitUntil: 'networkidle', timeout: 60000 });
    if (page.url().includes('/auth')) { log('sesión vencida → login programático'); await login(); await page.goto(`${BASE}/practica`, { waitUntil: 'networkidle', timeout: 60000 }); }
    log('en /practica. title:', await page.title(), 'url:', page.url());
    if (page.url().includes('/auth')) { console.error('🔴 login falló'); await page.screenshot({ path: `${OUT}-login-fail.png` }); await browser.close(); process.exit(2); }
    // Aceptar el gate de políticas si aparece (usuario QA sin aceptar).
    for (let i = 0; i < 6; i++) {
      const acepto = page.getByRole('button', { name: /^Acepto$/ }).first();
      if (await acepto.isVisible().catch(() => false)) { await acepto.click(); await page.waitForTimeout(900); } else break;
    }
    await page.screenshot({ path: `${OUT}-1-lista.png` });

    // Botón "Practicar" de la misión "Crear una requisición".
    const card = page.locator('text=Crear una requisición').first();
    await card.waitFor({ timeout: 10000 });
    // El botón Practicar dentro de esa tarjeta (o el primer Practicar).
    const btn = page.getByRole('button', { name: /Practicar/i }).first();
    await btn.click();
    await page.waitForTimeout(2500);
    log('tras Practicar, url:', page.url());
    await page.screenshot({ path: `${OUT}-2-pantalla-real.png` });

    // ¿Salió la banda de práctica?
    const banda = page.locator('text=MODO PRÁCTICA');
    const bandaVisible = await banda.isVisible().catch(() => false);
    log('banda MODO PRÁCTICA visible:', bandaVisible);

    // ¿Navegó a la pantalla real?
    const enReal = page.url().includes('/bitacora/solicitudes-material');
    log('en pantalla real (solicitudes-material):', enReal);

    // Abrir el drawer de nueva requisición (botón "Nueva" / "Crear").
    const nueva = page.getByRole('button', { name: /Nueva requisición|Nueva|Crear requisición|Solicitar/i }).first();
    if (await nueva.isVisible().catch(() => false)) {
      await nueva.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}-3-drawer.png` });
      // ¿La obra tiene opciones demo?
      const obraSelect = page.locator('select#proyecto_id');
      const opts = await obraSelect.locator('option').allTextContents().catch(() => []);
      log('opciones de obra:', JSON.stringify(opts));

      // ── Completar y enviar la requisición ──
      await obraSelect.selectOption({ label: 'OBRA DEMO — Torre Norte' }).catch(() => {});
      const add = page.getByRole('button', { name: /\+ Agregar|Agregar/ }).first();
      if (await add.isVisible().catch(() => false)) { await add.click(); await page.waitForTimeout(400); }
      // abrir el picker de artículo y elegir cemento
      await page.locator('.apk__trigger').first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator('.apk__search input, input[placeholder*="Buscar"]').first().fill('Cemento').catch(() => {});
      await page.waitForTimeout(600);
      await page.getByText('Cemento gris 42.5 (saco)').first().click().catch(() => {});
      await page.waitForTimeout(400);
      await page.locator('input.item-row__cantidad').first().fill('100').catch(() => {});
      await page.screenshot({ path: `${OUT}-3b-lleno.png` });
      // enviar (2 pasos: Revisar → Enviar requisición)
      await page.getByRole('button', { name: /Revisar/i }).first().click().catch(() => {});
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /Enviar requisición/i }).first().click().catch(() => {});
      await page.waitForTimeout(3500);
      const resVisible = await page.locator('.pb-res').isVisible().catch(() => false);
      const nota = await page.locator('.pb-res__nota').textContent().catch(() => null);
      log('resultado visible:', resVisible, '· nota:', nota);
      await page.screenshot({ path: `${OUT}-4-resultado.png` });
    } else {
      log('no encontré el botón de nueva requisición (revisar screenshot 2)');
    }

    console.log('\nERRORES DE CONSOLA:', errs.length ? errs.slice(0, 10) : 'ninguno');
    console.log('RESUMEN:', JSON.stringify({ bandaVisible, enReal, errores: errs.length }));
  } catch (e) {
    console.error('🔴 smoke falló:', e.message);
    await page.screenshot({ path: `${OUT}-error.png` }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
  await browser.close();
})();
