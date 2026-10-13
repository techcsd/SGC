// qa/practica-aprobar.smoke.mjs — render-check de la misión "Aprobar y despachar" a
// pantalla real (/inventario/requisiciones). Verifica: entra a la bandeja real, sale la
// banda MODO PRÁCTICA, el pedido demo (OBRA DEMO / Cemento) es visible, y el drawer de
// aprobación abre con el select de almacén y sus opciones demo.
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4200';
const OUT = join(__dirname, 'practica-aprobar');
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
    // Tarjeta "Aprobar y despachar"
    await page.getByText('Aprobar y despachar').first().waitFor({ timeout: 10000 });
    const card = page.locator('.pr-mision, .sgc-card, li, article').filter({ hasText: 'Aprobar y despachar' }).first();
    await (await card.getByRole('button', { name: /Practicar/i }).count() ? card.getByRole('button', { name: /Practicar/i }).first() : page.getByRole('button', { name: /Practicar/i }).first()).click();
    await page.waitForTimeout(2800);
    const enReal = page.url().includes('/inventario/requisiciones');
    const banda = await page.locator('text=MODO PRÁCTICA').isVisible().catch(() => false);
    const pedidoDemo = await page.getByText(/REQ-009007/i).first().isVisible().catch(() => false);
    log('url:', page.url(), '· enReal:', enReal, '· banda:', banda, '· pedidoDemo:', pedidoDemo);
    // abrir el pedido (botón Ver de la fila) → drawer → botón Aprobar
    const ver = page.getByRole('button', { name: /^Ver$/ }).first();
    if (await ver.isVisible().catch(() => false)) { await ver.click().catch(() => {}); await page.waitForTimeout(1200); }
    const btnAprobar = page.getByRole('button', { name: /^Aprobar$/ }).first();
    let drawer = false, selectAlmacen = false, opcionesDemo = false;
    if (await btnAprobar.isVisible().catch(() => false)) {
      await btnAprobar.click().catch(() => {}); await page.waitForTimeout(1000);
      drawer = true;
      selectAlmacen = await page.locator('#req-bodega').isVisible().catch(() => false);
      const opts = await page.locator('#req-bodega option').allTextContents().catch(() => []);
      opcionesDemo = opts.some((o) => /demo|central|torre norte/i.test(o));
    }
    await page.screenshot({ path: `${OUT}.png` });
    log('drawer:', drawer, '· selectAlmacen:', selectAlmacen, '· opcionesDemo:', opcionesDemo);
    console.log('RESUMEN:', JSON.stringify({ enReal, banda, pedidoDemo, drawer, selectAlmacen, opcionesDemo, errores: errs.length }));
  } catch (e) { console.error('🔴', e.message); await page.screenshot({ path: `${OUT}-err.png` }).catch(() => {}); }
  await browser.close();
})();
