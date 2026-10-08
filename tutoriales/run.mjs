// CK5 — grabador de videos "cómo hacer" (web). Graba SOLO en dev con usuario demo.
// Toma capturas en salida/debug/ para poder iterar selectores, y el video en webm →
// ffmpeg a mp4 + póster + vtt. Uso: node run.mjs web-apoyo-transporte
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertDev, assertTextoLimpio } from './lib/privacy-lock.mjs';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

// ── env desde ../.env.local ───────────────────────────────────────────────────
const env = {};
for (const l of readFileSync('../.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
// Graba contra el server local (ng serve con environment=dev → Supabase dev), así se
// evita el muro de Vercel Deployment Protection de dev.sgcconstructorasd.com. El candado
// permite localhost. Override con TUTORIAL_WEB_URL si se graba contra dev.* con bypass.
const WEB = process.env.TUTORIAL_WEB_URL || 'http://localhost:4200';
const EMAIL = env.STORE_REVIEW_SUPERVISOR_EMAIL_DEV;
const PASS = env.STORE_REVIEW_SUPERVISOR_PASSWORD_DEV;
assertDev(WEB);
if (!EMAIL || !PASS) { console.error('Faltan STORE_REVIEW_SUPERVISOR_*_DEV en ../.env.local'); process.exit(1); }

const DEMO = { cedulas: ['000-0000000-0'], placas: ['DEMO-001', 'DEMO-002', 'DEMO-003'] };
const OBRA_DEMO = 'OBRA DEMO — Residencial Ejemplo';
const outDir = 'salida', dbg = 'salida/debug';
mkdirSync(dbg, { recursive: true });

let shotN = 0;
const shot = async (page, name) => { await page.screenshot({ path: `${dbg}/${String(++shotN).padStart(2, '0')}-${name}.png` }).catch(() => {}); };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Descarta los modales de bienvenida (políticas CI3 / idioma BS4 / tour "Bienvenido") que
// pueden aparecer en cadena y tapar la pantalla. Varias rondas hasta que no quede ninguno.
async function dismissModales(page) {
  // OJO: nunca tocar "Cerrar sesión" (logout). Solo botones de cerrar modal/onboarding.
  for (let i = 0; i < 6; i++) {
    let hizo = false;
    const esp = page.getByRole('button', { name: /^Español/ });
    if (await esp.count()) { await esp.first().click().catch(() => {}); hizo = true; await pausa(300); }
    for (const re of [/^Acepto$/i, /^OK$/i, /^Saltar$/i, /^(Omitir|Entendido|Listo)$/i]) {
      const b = page.getByRole('button', { name: re });
      if (await b.count()) { await b.first().click().catch(() => {}); hizo = true; await pausa(600); }
    }
    const saltar = page.getByText(/^Saltar$/).first();
    if (await saltar.count()) { await saltar.click().catch(() => {}); hizo = true; await pausa(600); }
    if (!hizo) break;
  }
  // Si por error quedó abierto el confirm de logout, cancelarlo.
  const cancelar = page.getByRole('button', { name: /^Cancelar$/i });
  if (await cancelar.count()) { await cancelar.first().click().catch(() => {}); await pausa(500); }
  await pausa(500);
}

// Anillo de clic (CSS inyectado) — resalta dónde se hace clic.
const RING_CSS = `.ck-ring{position:fixed;z-index:99999;width:48px;height:48px;border:3px solid #f97316;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:ckr .6s ease-out}@keyframes ckr{from{opacity:1;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}`;

async function ring(page, locator) {
  try {
    const box = await locator.boundingBox();
    if (box) await page.evaluate(([x, y]) => {
      const d = document.createElement('div'); d.className = 'ck-ring';
      d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d);
      setTimeout(() => d.remove(), 600);
    }, [box.x + box.width / 2, box.y + box.height / 2]);
  } catch { /* noop */ }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
    locale: 'es-DO',
  });
  const page = await context.newPage();
  await page.addStyleTag({ content: RING_CSS }).catch(() => {});

  try {
    // ── Login ──
    console.log('→ login');
    await page.goto(`${WEB}/auth`, { waitUntil: 'networkidle', timeout: 45000 });
    await shot(page, 'auth');
    // Asegura modo "Con correo" si existe el toggle.
    const conCorreo = page.getByRole('button', { name: /Con correo/i });
    if (await conCorreo.count()) { await conCorreo.first().click().catch(() => {}); }
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASS);
    await shot(page, 'auth-filled');
    await page.getByRole('button', { name: /Iniciar sesión/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 45000 }).catch(() => {});
    await pausa(2000);
    await shot(page, 'post-login');

    await dismissModales(page);

    // ── Apoyo de transporte ──
    console.log('→ /transporte/apoyo');
    await page.goto(`${WEB}/transporte/apoyo`, { waitUntil: 'networkidle', timeout: 45000 });
    await pausa(1500);
    await dismissModales(page); // el tour "Bienvenido" persiste tras navegar
    await shot(page, 'apoyo-lista');

    const nuevo = page.getByRole('button', { name: /Nuevo apoyo/i });
    await ring(page, nuevo); await pausa(400); await nuevo.click();
    await pausa(1200); await shot(page, 'apoyo-drawer');

    // Scoped a los botones del drawer (.apoyo-tipo) para no chocar con los chips de las tarjetas.
    const tipo = page.locator('.apoyo-tipo').filter({ hasText: 'Movimiento interno' });
    if (await tipo.count()) { await ring(page, tipo.first()); await tipo.first().click(); await pausa(600); }

    await page.locator('#ap-obra').selectOption({ label: OBRA_DEMO }).catch(async () => {
      await page.locator('#ap-obra').selectOption({ index: 1 }).catch(() => {});
    });
    await pausa(500);
    await page.locator('#ap-desc').fill('20 sacos de cemento sobrantes del 3er nivel');
    await pausa(600); await shot(page, 'apoyo-form');

    await page.locator('input[type="file"]').first().setInputFiles('assets/demo-foto.jpg').catch((e) => console.log('foto:', e.message));
    await pausa(1500); await shot(page, 'apoyo-foto');

    // Candado de texto antes de "guardar".
    assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);

    const crear = page.getByRole('button', { name: /Crear apoyo/i });
    await ring(page, crear); await pausa(400); await crear.click().catch((e) => console.log('crear:', e.message));
    await pausa(2500); await shot(page, 'apoyo-creado');

    // Candado final.
    assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);
    console.log('✓ flujo grabado');
  } catch (e) {
    console.error('✗ error en el flujo:', e.message);
    await shot(page, 'ERROR');
  }

  const video = await page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();
  console.log('webm:', webm);

  // ── ffmpeg: webm → mp4 + póster ──
  const mp4 = `${outDir}/web-apoyo-transporte-v1.mp4`;
  const poster = `${outDir}/web-apoyo-transporte-v1.jpg`;
  execFileSync(FFMPEG, ['-y', '-i', webm, '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  execFileSync(FFMPEG, ['-y', '-i', mp4, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', poster], { stdio: 'inherit' });
  console.log('✓ mp4:', mp4);
  console.log('✓ poster:', poster);
}

main().catch((e) => { console.error(e); process.exit(1); });
