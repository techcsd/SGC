// qa/cp-ronda-prod-readonly.smoke.mjs — verificación READ-ONLY contra la prod real
// (sgcconstructorasd.com) tras promover la ronda CP. No crea reuniones/acuerdos/
// conversaciones permanentes — solo navega y confirma que cada pantalla carga sin
// errores, con la cuenta real de Xaviel (tecnologia@constructorasd.com).
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://sgcconstructorasd.com';
const OUT = join(__dirname, 'cp-ronda-prod');
const EMAIL = 'tecnologia@constructorasd.com';
const log = (...a) => console.log('·', ...a);
const resultados = {};

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
    // No se usa (ni se resetea) la contraseña real de Xaviel: se abre sesión vía
    // magic link (service role) y se inyecta en localStorage, el mismo mecanismo
    // que usa el puente de WhatsApp del edge — no toca sus credenciales.
    const SUPA_URL = process.env.SUPABASE_URL_PROD || 'https://jeeqhgccqefbqilntcpu.supabase.co';
    const ANON = process.env.SUPABASE_ANON_KEY_PROD;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD;
    const PROJECT_REF = process.env.SUPABASE_PROJECT_REF_PROD || 'jeeqhgccqefbqilntcpu';

    const linkRes = await fetch(`${SUPA_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
    });
    const link = await linkRes.json();
    if (!link.hashed_token) throw new Error('No se pudo generar magic link: ' + JSON.stringify(link).slice(0, 300));
    const vres = await fetch(`${SUPA_URL}/auth/v1/verify`, {
      method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
    });
    const session = await vres.json();
    if (!session.access_token) throw new Error('No se pudo verificar sesión: ' + JSON.stringify(session).slice(0, 300));

    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(({ key, session }) => {
      localStorage.setItem(key, JSON.stringify({
        access_token: session.access_token, refresh_token: session.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
        expires_in: session.expires_in ?? 3600, token_type: 'bearer', user: session.user,
      }));
    }, { key: `sb-${PROJECT_REF}-auth-token`, session });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    resultados.login = !page.url().includes('/auth');
    log('login (magic link) OK:', resultados.login, 'url:', page.url());
    await cerrarNovedadesSiSale();

    await page.goto(`${BASE}/proyectos/personal`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1500);
    resultados.personal_carga = await page.getByText(/Expedientes completos/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-personal.png`, fullPage: true });

    await page.goto(`${BASE}/reuniones`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    resultados.reuniones_carga = await page.getByText(/Reuniones/i).first().isVisible().catch(() => false);
    resultados.reuniones_sin_error = !page.url().includes('error');
    await page.screenshot({ path: `${OUT}-reuniones.png`, fullPage: true });

    await page.goto(`${BASE}/asistente`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    resultados.compa_carga = await page.getByText(/Tecnología puede revisar/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-compa.png`, fullPage: true });

    await page.goto(`${BASE}/admin/compa-conversaciones`, { waitUntil: 'networkidle', timeout: 30000 });
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1500);
    resultados.admin_compa_carga = await page.getByText(/Conversaciones de Compa/i).first().isVisible().catch(() => false);
    await page.screenshot({ path: `${OUT}-admin-compa.png`, fullPage: true });

    await page.goto(`${BASE}/tecnologia/compras`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await cerrarNovedadesSiSale();
    await page.waitForTimeout(1000);
    resultados.compras_carga = !page.url().includes('/auth');

  } catch (e) {
    console.error('🔴 ERROR:', e.message);
    await page.screenshot({ path: `${OUT}-error.png` }).catch(() => {});
    resultados.error = e.message;
  }

  resultados.errores_consola = errores.length;
  if (errores.length) log('errores:', JSON.stringify(errores.slice(0, 10)));
  console.log('\nRESUMEN:', JSON.stringify(resultados, null, 1));
  await browser.close();
})();
