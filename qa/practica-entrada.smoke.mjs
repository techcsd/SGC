// qa/practica-entrada.smoke.mjs — render-check de la misión "Registrar una entrada".
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4200';
const OUT = join(__dirname, 'practica-entrada');
const log = (...a) => console.log('·', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  try {
    await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('#email').fill(process.env.SGC_QA_EMAIL);
    await page.locator('#password').fill(process.env.SGC_QA_PASSWORD);
    await page.locator('#password').press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30000 }).catch(() => {});
    await page.goto(`${BASE}/practica`, { waitUntil: 'networkidle', timeout: 60000 });
    for (let i = 0; i < 6; i++) { const a = page.getByRole('button', { name: /^Acepto$/ }).first(); if (await a.isVisible().catch(() => false)) { await a.click(); await page.waitForTimeout(900); } else break; }
    // Tarjeta "Registrar una entrada de inventario"
    await page.getByText('Registrar una entrada de inventario').first().waitFor({ timeout: 10000 });
    // El botón Practicar de esa tarjeta (está en el mismo contenedor)
    const card = page.locator('.pr-mision, .sgc-card, li, article').filter({ hasText: 'Registrar una entrada de inventario' }).first();
    await (await card.getByRole('button', { name: /Practicar/i }).count() ? card.getByRole('button', { name: /Practicar/i }).first() : page.getByRole('button', { name: /Practicar/i }).nth(2)).click();
    await page.waitForTimeout(2800);
    const enReal = page.url().includes('/inventario/entradas');
    const banda = await page.locator('text=MODO PRÁCTICA').isVisible().catch(() => false);
    log('url:', page.url(), '· enReal:', enReal, '· banda:', banda);
    // abrir el drawer de nueva entrada
    const nueva = page.getByRole('button', { name: /Nueva entrada|Registrar entrada|Nueva|Registrar/i }).first();
    if (await nueva.isVisible().catch(() => false)) { await nueva.click(); await page.waitForTimeout(1200); }
    await page.screenshot({ path: `${OUT}.png` });
    // ¿hay selects con opciones demo (almacén/artículo)?
    const selects = await page.locator('select').count();
    const opts = await page.locator('select option').allTextContents().catch(() => []);
    const tieneDemo = opts.some((o) => /demo|central|cemento|torre norte/i.test(o));
    log('selects:', selects, '· opciones demo visibles:', tieneDemo);
    console.log('RESUMEN:', JSON.stringify({ enReal, banda, tieneDemo, errores: errs.length }));
  } catch (e) { console.error('🔴', e.message); await page.screenshot({ path: `${OUT}-err.png` }).catch(() => {}); }
  await browser.close();
})();
