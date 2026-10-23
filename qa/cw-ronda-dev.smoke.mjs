// qa/cw-ronda-dev.smoke.mjs — pasada real (headless, sin GUI) de las pantallas
// nuevas/tocadas en la ronda CW. Mismo patrón que qa/cv-ronda.smoke.mjs: un
// `ng serve` LOCAL (npm run env:dev antes) apuntando al backend de sgc-dev —
// NO contra https://dev.sgcconstructorasd.com directo, porque ese dominio
// está detrás del SSO de Vercel y el fragmento del magic link nunca llega a
// la SPA (gotcha ya documentado en HANDOFF, ronda CV).
//
//   npm run env:dev && npx ng serve --port 4200   (en otra terminal)
//   node qa/cw-ronda-dev.smoke.mjs
import '../scripts/lib/load-env.mjs';
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4200';
const OUT = join(__dirname, 'cw-ronda-dev');
const EMAIL = process.env.SGC_QA_EMAIL || 'qa_admin@constructorasd.com';
const SUPABASE_URL = process.env.SUPABASE_URL_DEV;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;
const log = (...a) => console.log('·', ...a);
const resultados = {};

async function sesionPorMagicLink(page) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  const link = await res.json();
  const actionLink = link?.action_link ?? link?.properties?.action_link;
  if (!actionLink) throw new Error(`No se pudo generar el magic link: ${JSON.stringify(link).slice(0, 300)}`);
  let hashParams = null;
  const onResponse = (r) => {
    if (r.status() >= 300 && r.status() < 400) {
      const loc = r.headers()['location'];
      if (loc?.includes('access_token=')) hashParams = loc.split('#')[1];
    }
  };
  page.on('response', onResponse);
  await page.goto(actionLink, { waitUntil: 'commit', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  page.off('response', onResponse);
  if (!hashParams) throw new Error('No se capturó el fragmento de tokens del magic link.');
  await page.goto(`${BASE}/#${hashParams}`, { waitUntil: 'networkidle', timeout: 30000 });
}

(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Falta SUPABASE_URL_DEV / SUPABASE_SERVICE_ROLE_KEY_DEV en .env.local');
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('CONSOLE: ' + m.text().slice(0, 200)); });

  async function cerrarNovedadesSiSale() {
    await page.waitForTimeout(600);
    const velo = page.locator('.novedades__velo').first();
    if (await velo.isVisible().catch(() => false)) {
      const btn = page.getByRole('button', { name: /Entendido/i }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  try {
    await sesionPorMagicLink(page);
    await page.waitForTimeout(1000);
    resultados.login = !page.url().includes('/auth');
    log('login:', resultados.login, page.url());
    await cerrarNovedadesSiSale();

    // ── CW1 — /admin/conduces-huerfanos ─────────────────────────────────────
    await page.goto(`${BASE}/admin/conduces-huerfanos`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    resultados.cw1_carga = page.url().includes('conduces-huerfanos');
    resultados.cw1_titulo = await page.getByRole('heading', { name: /Conduces huérfanos/i }).isVisible().catch(() => false);
    resultados.cw1_filtros = await page.getByRole('button', { name: /3 días/i }).isVisible().catch(() => false);
    log('CW1 conduces-huerfanos: carga=%s titulo=%s filtros=%s', resultados.cw1_carga, resultados.cw1_titulo, resultados.cw1_filtros);
    await page.screenshot({ path: `${OUT}-cw1-conduces-huerfanos.png`, fullPage: true }).catch(() => {});

    // ── CW4 — /flota/rendimiento-vehiculos ──────────────────────────────────
    await page.goto(`${BASE}/flota/rendimiento-vehiculos`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    resultados.cw4_carga = page.url().includes('rendimiento-vehiculos');
    resultados.cw4_titulo = await page.getByRole('heading', { name: /Rendimiento por vehículo/i }).isVisible().catch(() => false);
    resultados.cw4_excel_btn = await page.getByRole('button', { name: /Excel/i }).isVisible().catch(() => false);
    resultados.cw4_pdf_btn = await page.getByRole('button', { name: /PDF/i }).isVisible().catch(() => false);
    resultados.cw4_tab_subnav = await page.getByRole('link', { name: /Rendimiento/i }).isVisible().catch(() => false);
    log('CW4 rendimiento-vehiculos: carga=%s titulo=%s excelBtn=%s pdfBtn=%s tabSubnav=%s',
      resultados.cw4_carga, resultados.cw4_titulo, resultados.cw4_excel_btn, resultados.cw4_pdf_btn, resultados.cw4_tab_subnav);
    await page.screenshot({ path: `${OUT}-cw4-rendimiento.png`, fullPage: true }).catch(() => {});

    // ── CW6/CW7 — /flota/choferes-privados (solo lectura, NO se toca el interruptor) ──
    await page.goto(`${BASE}/flota/choferes-privados`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    resultados.cw6_carga = page.url().includes('choferes-privados');
    resultados.cw6_titulo = await page.getByRole('heading', { name: /Choferes privados/i }).isVisible().catch(() => false);
    resultados.cw6_interruptor_texto = await page.getByText(/También conduces y rutas de empresa/i).first().isVisible().catch(() => false);
    log('CW6/7 choferes-privados: carga=%s titulo=%s interruptorVisible=%s (NO se le dio clic)',
      resultados.cw6_carga, resultados.cw6_titulo, resultados.cw6_interruptor_texto);
    await page.screenshot({ path: `${OUT}-cw6-choferes-privados.png`, fullPage: true }).catch(() => {});

    // ── CW3 — Dev notes: nota de prueba, sacarla de una carpeta, selector de Carpeta ──
    await page.goto(`${BASE}/tecnologia/dev-notes`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    const cerrarNota = page.locator('button[title="Cerrar nota"]');
    if (await cerrarNota.isVisible().catch(() => false)) { await cerrarNota.click(); await page.waitForTimeout(500); }

    const nombreGrupo = 'QA-CW-' + Math.random().toString(36).slice(2, 7);
    await page.getByRole('button', { name: /Nuevo grupo/i }).click();
    await page.waitForTimeout(300);
    await page.locator('.dn-grupo-edit__row input').fill(nombreGrupo);
    await page.locator('.dn-grupo-edit__row input').press('Enter');
    await page.waitForTimeout(800);
    resultados.cw3_grupo_creado = await page.locator(`.dev-notes__grupo-nombre:has-text("${nombreGrupo}")`).isVisible().catch(() => false);

    await page.getByRole('button', { name: /^Nueva/i }).first().click();
    await page.waitForTimeout(800);
    await page.locator('.dn-titulo').fill('QA-CW smoke (borrar)');
    await page.waitForTimeout(400);
    const selectorCarpeta = page.locator('.dn-editor__carpeta select');
    resultados.cw3_selector_carpeta_visible = await selectorCarpeta.isVisible().catch(() => false);
    if (resultados.cw3_selector_carpeta_visible) {
      await selectorCarpeta.selectOption({ label: nombreGrupo });
      await page.waitForTimeout(800);
      resultados.cw3_movida_por_selector = await page.locator('.toast__titulo', { hasText: /Nota movida/i }).isVisible().catch(() => false);
      await page.screenshot({ path: `${OUT}-cw3-selector-carpeta.png` }).catch(() => {});

      await selectorCarpeta.selectOption({ label: 'Sin grupo' });
      await page.waitForTimeout(800);
      resultados.cw3_sacada_a_sin_grupo = await page.locator('.toast__titulo', { hasText: /Nota movida|Sin grupo/i }).isVisible().catch(() => false);
      await page.screenshot({ path: `${OUT}-cw3-sin-grupo.png` }).catch(() => {});
    }
    log('CW3 dev-notes: grupoCreado=%s selectorCarpetaVisible=%s movidaPorSelector=%s sacadaASinGrupo=%s',
      resultados.cw3_grupo_creado, resultados.cw3_selector_carpeta_visible, resultados.cw3_movida_por_selector, resultados.cw3_sacada_a_sin_grupo);

    // Limpieza: eliminar la nota de prueba y el grupo de prueba.
    const btnEliminarNota = page.locator('.dev-notes__editor-foot button', { hasText: /Eliminar/i });
    if (await btnEliminarNota.isVisible().catch(() => false)) {
      await btnEliminarNota.click();
      await page.waitForTimeout(400);
      const confirmar = page.getByRole('button', { name: /^Eliminar$/i }).last();
      if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
      await page.waitForTimeout(800);
      resultados.cw3_limpieza_nota = true;
    }
    const cerrarNota2 = page.locator('button[title="Cerrar nota"]');
    if (await cerrarNota2.isVisible().catch(() => false)) { await cerrarNota2.click(); await page.waitForTimeout(500); }
    const grupoHead = page.locator('.dev-notes__grupo-head', { hasText: nombreGrupo }).first();
    if (await grupoHead.isVisible().catch(() => false)) {
      await grupoHead.locator('.dn-menu-trigger').click().catch(() => {});
      await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: /Eliminar/i }).click().catch(() => {});
      await page.waitForTimeout(300);
      const confirmarGrupo = page.getByRole('button', { name: /^Eliminar$/i }).last();
      if (await confirmarGrupo.isVisible().catch(() => false)) await confirmarGrupo.click();
      await page.waitForTimeout(600);
      resultados.cw3_limpieza_grupo = true;
    }
    log('CW3 limpieza: nota=%s grupo=%s', resultados.cw3_limpieza_nota, resultados.cw3_limpieza_grupo);

    resultados.sin_errores_consola = errores.length === 0;
    if (errores.length) { resultados.errores = errores.slice(0, 10); log('errores de consola:', errores.slice(0, 5)); }
  } catch (e) {
    resultados.excepcion = String(e.message || e).slice(0, 400);
    log('EXCEPCIÓN:', resultados.excepcion);
    await page.screenshot({ path: `${OUT}-excepcion.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log('\n=== RESULTADOS (DEV) ===');
  console.log(JSON.stringify(resultados, null, 2));
})();
