// qa/cv-ronda.smoke.mjs — verificación end-to-end de la ronda CV contra dev
// (apunta un `ng serve` local a sgc-dev; `npm run env:dev` antes de levantarlo).
// Cubre: Compa "Registra una echada" → tarjeta "Echada preparada" → "Abrir
// formulario" → prefill en Combustible; Dev notes: crear grupo en línea,
// arrastrar una nota a un grupo.
//
//   node qa/cv-ronda.smoke.mjs
//
// La sesión se genera con un magic link (service role, sin tocar contraseñas —
// mismo patrón que scripts/compa-evals.mjs) y se inyecta vía el fragmento
// #access_token=... de la URL, porque el Site URL de Supabase en dev redirige a
// dev.sgcconstructorasd.com (detrás del SSO de Vercel) — no a localhost.
import '../scripts/lib/load-env.mjs';
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4200';
const OUT = join(__dirname, 'cv-ronda');
const EMAIL = process.env.SGC_QA_EMAIL || 'tecnologia@constructorasd.com';
const SUPABASE_URL = process.env.SUPABASE_URL_DEV || 'https://fzfrnrvndzrjwyvdpkgg.supabase.co';
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
    // ── Login (magic link headless, ver sesionPorMagicLink arriba) ──────────
    if (!SERVICE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY_DEV en .env.local');
    await sesionPorMagicLink(page);
    await page.waitForTimeout(1000);
    resultados.login = !page.url().includes('/auth');
    log('login:', resultados.login, page.url());
    await cerrarNovedadesSiSale();

    // ── CV1 — Compa "Registra una echada" ───────────────────────────────────
    await page.goto(`${BASE}/asistente`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    const input = page.locator('textarea.compa__input');
    await input.fill('Registra una echada: la Suburban, 12 galones, 3360 pesos');
    await input.press('Enter');
    // Compa puede tardar varios segundos (llamadas a Claude + RPC).
    await page.waitForSelector('.compa__propuesta', { timeout: 30000 }).catch(() => {});
    const propuestaVisible = await page.locator('.compa__propuesta').isVisible().catch(() => false);
    const tieneAbrirFormulario = await page.getByRole('button', { name: /Abrir formulario/i }).isVisible().catch(() => false);
    const dijoRegistrada = (await page.locator('.compa__msg--assistant').last().innerText().catch(() => ''))
      .match(/ya (qued[oó]|est[aá]) registrad/i);
    resultados.compa_propuesta = propuestaVisible;
    resultados.compa_abrir_formulario = tieneAbrirFormulario;
    resultados.compa_no_dice_registrada = !dijoRegistrada;
    log('Compa: propuesta=%s abrirFormulario=%s noDiceRegistrada=%s', propuestaVisible, tieneAbrirFormulario, !dijoRegistrada);
    await page.screenshot({ path: `${OUT}-compa-propuesta.png` }).catch(() => {});

    if (tieneAbrirFormulario) {
      await page.getByRole('button', { name: /Abrir formulario/i }).click();
      await page.waitForURL(/\/flota\/combustible/, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      resultados.combustible_nav = page.url().includes('/flota/combustible');
      resultados.combustible_banner = await page.locator('.cmb-compa-banner').isVisible().catch(() => false);
      resultados.combustible_chip_galones = (await page.locator('.cmb-chip-compa').count().catch(() => 0)) > 0;
      // Sin fotos ni odómetro, "Registrar combustible" NO debe guardar (el drawer se queda abierto).
      await page.getByRole('button', { name: /Registrar combustible/i }).click().catch(() => {});
      await page.waitForTimeout(500);
      resultados.combustible_bloquea_sin_fotos = await page.locator('.cmb-compa-banner').isVisible().catch(() => false);
      log('Combustible: nav=%s banner=%s chip=%s bloqueaSinFotos=%s',
        resultados.combustible_nav, resultados.combustible_banner, resultados.combustible_chip_galones, resultados.combustible_bloquea_sin_fotos);
      await page.screenshot({ path: `${OUT}-combustible-prefill.png` }).catch(() => {});
    }

    // ── CV2/CV3 — Dev notes: crear grupo + arrastrar una nota ───────────────
    await page.goto(`${BASE}/tecnologia/dev-notes`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    // Si entra directo al editor a pantalla completa (abre la última nota), vuelve a la lista.
    const cerrarNota = page.locator('button[title="Cerrar nota"]');
    if (await cerrarNota.isVisible().catch(() => false)) {
      await cerrarNota.click();
      await page.waitForTimeout(500);
    }
    await page.getByRole('button', { name: /Nuevo grupo/i }).click();
    await page.waitForTimeout(300);
    const nombreGrupo = 'QA-CV-' + Math.random().toString(36).slice(2, 7);
    await page.locator('.dn-grupo-edit__row input').fill(nombreGrupo);
    await page.locator('.dn-grupo-edit__row input').press('Enter');
    await page.waitForTimeout(800);
    const grupoCreado = await page.locator(`.dev-notes__grupo-nombre:has-text("${nombreGrupo}")`).isVisible().catch(() => false);
    resultados.grupo_creado = grupoCreado;
    log('Dev notes: grupo creado =', grupoCreado);
    await page.screenshot({ path: `${OUT}-grupo-creado.png` }).catch(() => {});

    // Arrastrar la primera nota disponible sobre el grupo recién creado (HTML5 DnD).
    const primeraNota = page.locator('.note-card-wrap').first();
    const grupoHead = page.locator('.dev-notes__grupo-head', { hasText: nombreGrupo }).first();
    if (await primeraNota.isVisible().catch(() => false) && grupoCreado) {
      const tituloNota = await primeraNota.locator('.note-card__title').innerText().catch(() => '');
      // dragTo simula dragstart/dragover/drop con dataTransfer real (Playwright >=1.12).
      await primeraNota.dragTo(grupoHead).catch((e) => log('dragTo falló:', e.message));
      await page.waitForTimeout(800);
      const toastMovida = await page.locator('.toast__titulo', { hasText: /Nota movida/i }).isVisible().catch(() => false);
      resultados.nota_arrastrada = toastMovida;
      log('Dev notes: nota "%s" arrastrada, toast "Nota movida"=%s', tituloNota.trim(), toastMovida);
      await page.screenshot({ path: `${OUT}-nota-arrastrada.png` }).catch(() => {});
    } else {
      log('sin nota disponible para arrastrar (o el grupo no se creó) — se omite el paso de arrastre');
    }

    resultados.sin_errores_consola = errores.length === 0;
    if (errores.length) log('errores de consola:', errores.slice(0, 5));
  } catch (e) {
    resultados.excepcion = String(e.message || e).slice(0, 300);
    log('EXCEPCIÓN:', resultados.excepcion);
    await page.screenshot({ path: `${OUT}-excepcion.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log('\n=== RESULTADOS ===');
  console.log(JSON.stringify(resultados, null, 2));
})();
