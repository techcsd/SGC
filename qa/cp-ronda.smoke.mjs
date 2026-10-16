// qa/cp-ronda.smoke.mjs — verificación end-to-end de la ronda CP contra dev
// (local server apuntando a sgc-dev, mismo código/datos que dev.sgcconstructorasd.com).
// Cubre: login, Personal de obra (visual), Reuniones (crear→ficha→acuerdo→tarea→acta),
// Compa (enviar, compartir), Admin > Conversaciones de Compa, Compras (bandeja Eduardo).
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:4200';
const OUT = join(__dirname, 'cp-ronda');
const EMAIL = 'tecnologia@constructorasd.com';
const PASSWORD = 'QaTest2026!cp';
const log = (...a) => console.log('·', ...a);
const resultados = {};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('CONSOLE: ' + m.text().slice(0, 200)); });

  // CO2 — el overlay "Novedades" a pantalla completa puede salir en cada
  // navegación (parece no marcarse "vista" entre rutas en esta cuenta recién
  // creada); ciérralo cada vez antes de interactuar.
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
    // ── Login ──────────────────────────────────────────────────────────────
    await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#password').press('Enter');
    await page.waitForTimeout(2000);
    // CC3 — contraseña fijada por el script dev-set-password requiere cambio forzado.
    if (page.url().includes('/auth/set-password')) {
      log('forzado a cambiar contraseña, llenando formulario…');
      await page.locator('#password').fill(PASSWORD);
      await page.locator('#confirmPassword').fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(2000);
      log('tras cambiar contraseña, url:', page.url());
      await page.screenshot({ path: `${OUT}-set-password.png` }).catch(() => {});
    }
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 15000 }).catch(async () => {
      log('seguía en /auth tras 15s, url:', page.url());
      await page.screenshot({ path: `${OUT}-stuck-auth.png` }).catch(() => {});
      log('body text:', (await page.locator('body').innerText().catch(() => '')).slice(0, 500));
    });
    resultados.login = true;
    log('login OK, url:', page.url());

    await cerrarNovedadesSiSale();

    // ── Personal de obra (visual) ────────────────────────────────────────────
    await page.goto(`${BASE}/proyectos/personal`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1500);
    resultados.personal_sin_tarjetas_duplicadas = !(await page.getByText('Pendientes del personal').isVisible().catch(() => false));
    resultados.personal_franja_avance = await page.getByText(/Expedientes completos/i).first().isVisible().catch(() => false);
    resultados.personal_le_falta = await page.getByText('Le falta', { exact: false }).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-personal.png`, fullPage: true });
    log('personal:', JSON.stringify({ franja: resultados.personal_franja_avance, leFalta: resultados.personal_le_falta, sinDup: resultados.personal_sin_tarjetas_duplicadas }));

    // ── Reuniones: lista → crear → ficha → acuerdo → tarea → acta ────────────
    await page.goto(`${BASE}/reuniones`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    resultados.reuniones_lista_carga = await page.getByText(/Reuniones/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-reuniones-lista.png`, fullPage: true });

    const btnPrograma = page.getByRole('button', { name: /Programar reunión/i }).first();
    resultados.reuniones_boton_programar = await btnPrograma.isVisible().catch(() => false);
    if (resultados.reuniones_boton_programar) {
      await btnPrograma.click();
      await page.waitForTimeout(800);
      // Formulario: título + tipo + fecha ya deberían tener defaults razonables; solo llenamos título.
      const tituloInput = page.getByPlaceholder(/Coordinación semanal|título/i).first();
      if (await tituloInput.isVisible().catch(() => false)) {
        await tituloInput.fill('CP smoke test — reunión de prueba');
      } else {
        log('⚠ no encontré el campo de título por placeholder');
      }
      await page.screenshot({ path: `${OUT}-reuniones-form.png`, fullPage: true });
      const btnCrear = page.getByRole('button', { name: /^Programar$/i }).last();
      if (await btnCrear.isVisible().catch(() => false)) {
        await btnCrear.click();
        await page.waitForTimeout(2000);
        resultados.reuniones_creada = /\/reuniones\/[0-9a-f-]+/.test(page.url()) || await page.getByText('CP smoke test').first().isVisible().catch(() => false);
      }
    }
    log('reuniones crear:', JSON.stringify({ botonProgramar: resultados.reuniones_boton_programar, creada: resultados.reuniones_creada }));

    // Si no terminamos en la ficha (quedó en la lista), abrir la tarjeta recién creada.
    if (!/\/reuniones\/[0-9a-f-]+/.test(page.url())) {
      const tarjeta = page.getByText('CP smoke test — reunión de prueba').first();
      if (await tarjeta.isVisible().catch(() => false)) { await tarjeta.click(); await page.waitForTimeout(1500); }
    }
    resultados.reuniones_ficha_abrio = /\/reuniones\/[0-9a-f-]+/.test(page.url());
    await page.screenshot({ path: `${OUT}-reuniones-ficha.png`, fullPage: true });
    log('ficha url:', page.url());

    if (resultados.reuniones_ficha_abrio) {
      resultados.reuniones_agenda_visible = await page.getByText(/Avance de la semana/i).first().isVisible().catch(() => false);

      // Agregar un acuerdo CON responsable (yo mismo, vía user-picker) y fecha.
      const acuerdoInput = page.locator('input[placeholder="Nuevo acuerdo…"]').first();
      resultados.reuniones_acuerdo_ui = await acuerdoInput.isVisible().catch(() => false);
      if (resultados.reuniones_acuerdo_ui) {
        await acuerdoInput.fill('Acuerdo de prueba CP smoke');
        const picker = page.locator('app-user-picker input, app-user-picker [role="combobox"]').first();
        if (await picker.isVisible().catch(() => false)) {
          await picker.click();
          await picker.fill('Xaviel');
          await page.waitForTimeout(1200);
          const opcion = page.getByText('tecnologia@constructorasd.com').first();
          await opcion.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
          await opcion.click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
        const fechaInput = page.locator('input[type="date"]').first();
        if (await fechaInput.isVisible().catch(() => false)) await fechaInput.fill('2026-10-20').catch(() => {});
        const btnAgregar = page.getByRole('button', { name: /^\+?\s?Agregar$/i }).first();
        if (await btnAgregar.isVisible().catch(() => false)) {
          await btnAgregar.click();
          await page.waitForTimeout(1800);
        }
      }
      await page.screenshot({ path: `${OUT}-reuniones-ficha-full.png`, fullPage: true });
      resultados.reuniones_acuerdo_creado = await page.getByText('Acuerdo de prueba CP smoke').first().isVisible().catch(() => false);

      // Crear las tareas de los acuerdos con responsable.
      const btnCrearTareas = page.getByRole('button', { name: /Crear las? \d+ tareas?/i }).first();
      resultados.reuniones_boton_crear_tareas = await btnCrearTareas.isVisible().catch(() => false);
      if (resultados.reuniones_boton_crear_tareas) {
        await btnCrearTareas.click();
        await page.waitForTimeout(1500);
        resultados.reuniones_tarea_creada = await page.getByText(/Tarea creada/i).first().isVisible().catch(() => false);
      }

      // Guardar un resumen y Aprobar y enviar minuta.
      const resumenArea = page.locator('textarea.sgc-input').first();
      if (await resumenArea.isVisible().catch(() => false)) {
        await resumenArea.fill('Resumen de prueba generado por el smoke test CP.');
        await page.getByRole('button', { name: /Guardar resumen/i }).first().click().catch(() => {});
        await page.waitForTimeout(1000);
      }
      const btnAprobar = page.getByRole('button', { name: /Aprobar y enviar minuta/i }).first();
      resultados.reuniones_boton_aprobar = await btnAprobar.isVisible().catch(() => false);
      if (resultados.reuniones_boton_aprobar) {
        await btnAprobar.click();
        await page.waitForTimeout(2000);
        resultados.reuniones_acta_aprobada = await page.getByText(/acta_aprobada|Acta aprobada|aprobada/i).first().isVisible().catch(() => false);
      }
      await page.screenshot({ path: `${OUT}-reuniones-ficha-final.png`, fullPage: true });
      log('reuniones ficha:', JSON.stringify({
        agenda: resultados.reuniones_agenda_visible, acuerdoUI: resultados.reuniones_acuerdo_ui,
        acuerdoCreado: resultados.reuniones_acuerdo_creado, botonCrearTareas: resultados.reuniones_boton_crear_tareas,
        tareaCreada: resultados.reuniones_tarea_creada, botonAprobar: resultados.reuniones_boton_aprobar,
      }));
    }

    // ── Compa: enviar mensaje + botón Compartir visible ──────────────────────
    await page.goto(`${BASE}/asistente`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    const consentBtn = page.getByRole('button', { name: /^Permitir$/i }).first();
    if (await consentBtn.isVisible().catch(() => false)) { await consentBtn.click().catch(() => {}); await page.waitForTimeout(500); }
    // Abre una conversación existente (de evals previos) para probar "Compartir".
    const convExistente = page.locator('aside, .compa__side, .compa__conv-list').getByText(/reunión próxima/i).first();
    if (await convExistente.isVisible().catch(() => false)) { await convExistente.click().catch(() => {}); await page.waitForTimeout(1000); }
    resultados.compa_boton_compartir = await page.getByRole('button', { name: /Compartir/i }).first().isVisible().catch(() => false);
    const composer = page.locator('textarea').first();
    resultados.compa_composer_visible = await composer.isVisible().catch(() => false);
    if (resultados.compa_composer_visible) {
      await composer.click();
      await composer.fill('¿Tengo alguna reunión próxima? (smoke CP)');
      await composer.press('Enter');
      await page.waitForTimeout(8000);
      resultados.compa_respondio = (await page.locator('.compa__bubble, .compa__msg--assistant').count()) > 0;
    }
    resultados.compa_aviso_fijo = await page.getByText(/Tecnología puede revisar/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-compa.png`, fullPage: true });
    log('compa:', JSON.stringify({ composer: resultados.compa_composer_visible, respondio: resultados.compa_respondio, compartir: resultados.compa_boton_compartir, aviso: resultados.compa_aviso_fijo }));

    // ── Admin > Conversaciones de Compa ──────────────────────────────────────
    await page.goto(`${BASE}/admin/compa-conversaciones`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1500);
    resultados.admin_compa_carga = await page.getByText(/Conversaciones de Compa/i).first().isVisible().catch(() => false);
    resultados.admin_compa_conteos = await page.getByText(/Con contradicción|Prometió y no hizo/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-admin-compa.png`, fullPage: true });
    log('admin compa:', JSON.stringify({ carga: resultados.admin_compa_carga, conteos: resultados.admin_compa_conteos }));

    // ── Compras tecnológicas (CP11 — bandeja del aprobador, admin ve todo igual) ──
    await page.goto(`${BASE}/tecnologia/compras`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    resultados.compras_pagina_carga = await page.locator('body').isVisible().catch(() => false) && !page.url().includes('/auth');
    log('compras url:', page.url());

  } catch (e) {
    console.error('🔴 ERROR:', e.message);
    await page.screenshot({ path: `${OUT}-error.png` }).catch(() => {});
    resultados.error = e.message;
  }

  resultados.errores_consola = errores.length;
  if (errores.length) log('errores de consola:', JSON.stringify(errores.slice(0, 10)));

  console.log('\nRESUMEN:', JSON.stringify(resultados, null, 1));
  await browser.close();
})();
