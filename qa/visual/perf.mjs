// qa/visual/perf.mjs — CB v2 / FASE 7. Mide métricas reales (LCP, CLS, carga,
// peso de fuentes, nº de backdrop-filter en vivo) en pantallas AUTENTICADAS con
// la sesión guardada (qa/visual/.auth.json). Alternativa a Lighthouse cuando no
// hay Chrome de sistema — usa el Chromium de Playwright.
//
// USO:  node qa/visual/perf.mjs [--base http://localhost:4200]

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--base');
const BASE = i >= 0 ? process.argv[i + 1] : process.env.SGC_QA_BASE || 'http://localhost:4200';
const AUTH = join(__dirname, '.auth.json');
const RUTAS = ['dashboard', 'inventario/conduces'];

if (!existsSync(AUTH)) { console.error('[perf] falta qa/visual/.auth.json — corre capturar.mjs primero.'); process.exit(1); }

async function medir(page, ruta) {
  await page.addInitScript(() => {
    window.__cls = 0; window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { const es = l.getEntries(); window.__lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(`${BASE}/${ruta}`, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fonts = performance.getEntriesByType('resource').filter((r) => /\.woff2?(\?|$)/.test(r.name));
    const fontKB = fonts.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0) / 1024;
    const glass = [...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
    }).length;
    return {
      lcp: Math.round(window.__lcp),
      cls: +window.__cls.toFixed(4),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      fontKB: Math.round(fontKB),
      fontFiles: fonts.length,
      glassLive: glass,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: AUTH, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  console.log(`\n  Rendimiento (Chromium ${BASE}) — sesión admin\n  ${'─'.repeat(70)}`);
  console.log('  ruta                     LCP(ms)  CLS     DCL(ms)  load(ms)  fonts  glass');
  for (const r of RUTAS) {
    try {
      const m = await medir(page, r);
      console.log(`  ${r.padEnd(24)} ${String(m.lcp).padStart(6)}  ${String(m.cls).padEnd(6)}  ${String(m.domContentLoaded).padStart(6)}  ${String(m.load).padStart(7)}   ${m.fontKB}KB/${m.fontFiles}  ${m.glassLive}`);
    } catch (e) { console.log(`  ${r.padEnd(24)} ERROR: ${e.message}`); }
  }
  console.log(`  ${'─'.repeat(70)}`);
  console.log('  Objetivos CB/FASE7: CLS<0.1 · glass simultáneo ≤2 · fuentes latin ~91KB\n');
  await browser.close();
})();
