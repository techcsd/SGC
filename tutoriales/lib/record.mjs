// CK5 — motor de grabación de tutoriales (compartido por todos los guiones).
// Graba SOLO en dev con usuario demo. Hornea en el propio video (sin post-proceso
// frágil de ffmpeg): una PORTADA (2 s), una BARRA DE PASOS en español con los colores
// CB, y un CIERRE (2 s). Genera además el .vtt con los tiempos reales de cada paso.
//
// Un "guion" es un objeto declarativo:
//   { id, plataforma:'web'|'app', titulo, viewport?, pasos: [{ texto, run?(ctx) }] }
// `run(ctx)` recibe { page, ring, shot, pausa, demo, obraDemo, web } y ejecuta las
// acciones del paso. El texto se muestra en la barra y se vuelve un subtítulo.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertDev, assertTextoLimpio } from './privacy-lock.mjs';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

// ── Config de entorno (desde ../.env.local) ────────────────────────────────────
function cargarEnv() {
  const env = {};
  for (const l of readFileSync('../.env.local', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// Datos demo permitidos por el candado de texto (nunca debe verse otra cosa).
const DEMO = { cedulas: ['000-0000000-0'], placas: ['DEMO-001', 'DEMO-002', 'DEMO-003'] };
const OBRA_DEMO = 'OBRA DEMO — Residencial Ejemplo';

// Colores CB (deben coincidir con los tokens de la web).
const CB = { navy: '#1e3a5f', naranja: '#f97316', texto: '#ffffff' };

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Anillo de clic + barra de pasos + portada/cierre (CSS/JS inyectado) ─────────
const OVERLAY_CSS = `
.ck-ring{position:fixed;z-index:2147483646;width:48px;height:48px;border:3px solid ${CB.naranja};border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:ckr .6s ease-out}
@keyframes ckr{from{opacity:1;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
#ck-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483645;background:${CB.navy}f2;color:${CB.texto};
  font-family:'Inter',system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:20px;
  padding:16px 36px;box-shadow:0 -6px 24px rgba(0,0,0,.25);transition:opacity .3s ease}
#ck-bar .ck-n{flex:0 0 auto;width:40px;height:40px;border-radius:50%;background:${CB.naranja};
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px}
#ck-bar .ck-txt{flex:1 1 auto;font-size:26px;font-weight:600;line-height:1.25}
#ck-bar .ck-prog{flex:0 0 auto;font-size:16px;opacity:.85;font-variant-numeric:tabular-nums}
#ck-bar .ck-fill{position:absolute;left:0;top:0;height:4px;background:${CB.naranja};transition:width .4s ease}
#ck-card{position:fixed;inset:0;z-index:2147483647;background:${CB.navy};color:${CB.texto};
  font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center}
#ck-card .ck-brand{font-size:22px;letter-spacing:.14em;text-transform:uppercase;opacity:.8}
#ck-card .ck-k{font-size:20px;color:${CB.naranja};font-weight:700;letter-spacing:.04em}
#ck-card .ck-h{font-size:52px;font-weight:800;max-width:70%;line-height:1.1}
#ck-card .ck-sub{font-size:22px;opacity:.85;max-width:60%}
`;

const OVERLAY_JS = `
window.__ck = {
  bar: null,
  mostrarBarra(total){
    if (this.bar) return;
    const b = document.createElement('div'); b.id='ck-bar';
    b.innerHTML = '<div class="ck-fill"></div><div class="ck-n">1</div><div class="ck-txt"></div><div class="ck-prog"></div>';
    document.body.appendChild(b); this.bar=b; this.total=total;
  },
  paso(n, texto){
    if(!this.bar) return;
    this.bar.querySelector('.ck-n').textContent = n;
    this.bar.querySelector('.ck-txt').textContent = texto;
    this.bar.querySelector('.ck-prog').textContent = n + ' / ' + this.total;
    this.bar.querySelector('.ck-fill').style.width = Math.round((n/this.total)*100) + '%';
  },
  ocultarBarra(){ if(this.bar){ this.bar.style.opacity='0'; } },
  card(brand, kicker, titulo, sub){
    let c = document.getElementById('ck-card');
    if(!c){ c=document.createElement('div'); c.id='ck-card'; document.body.appendChild(c); }
    c.style.display='flex';
    c.innerHTML = '<div class="ck-brand">'+brand+'</div><div class="ck-k">'+kicker+'</div>'+
      '<div class="ck-h">'+titulo+'</div>'+(sub?'<div class="ck-sub">'+sub+'</div>':'');
  },
  quitarCard(){ const c=document.getElementById('ck-card'); if(c) c.style.display='none'; }
};
`;

// Convierte ms → timestamp VTT (00:00:00.000)
function vttTime(ms) {
  const t = Math.max(0, ms);
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  const mm = String(Math.floor(t % 1000)).padStart(3, '0');
  return `${h}:${m}:${s}.${mm}`;
}

/**
 * Graba un guion de punta a punta y deja {id}-v{n}.mp4 + .jpg (póster) + .vtt en salida/.
 * Devuelve { mp4, poster, vtt, duracion_s }.
 */
export async function grabarGuion(guion, { outDir = 'salida', version = 1 } = {}) {
  const env = cargarEnv();
  const web = process.env.TUTORIAL_WEB_URL || 'http://localhost:4200';
  const email = env.STORE_REVIEW_SUPERVISOR_EMAIL_DEV;
  const pass = env.STORE_REVIEW_SUPERVISOR_PASSWORD_DEV;
  assertDev(web);
  if (!email || !pass) throw new Error('Faltan STORE_REVIEW_SUPERVISOR_*_DEV en ../.env.local');

  const dbg = `${outDir}/debug/${guion.id}`;
  mkdirSync(dbg, { recursive: true });
  const viewport = guion.viewport || { width: 1920, height: 1080 };

  let shotN = 0;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: outDir, size: viewport },
    locale: 'es-DO',
    deviceScaleFactor: guion.plataforma === 'app' ? 3 : 1,
  });
  const page = await context.newPage();
  const t0 = Date.now(); // referencia para los tiempos del VTT (≈ inicio de grabación)
  await page.addStyleTag({ content: OVERLAY_CSS }).catch(() => {});
  await page.addInitScript(OVERLAY_JS); // se re-inyecta en cada navegación

  const shot = async (name) =>
    page.screenshot({ path: `${dbg}/${String(++shotN).padStart(2, '0')}-${name}.png` }).catch(() => {});

  const ring = async (locator) => {
    try {
      const box = await locator.boundingBox();
      if (box) await page.evaluate(([x, y]) => {
        const d = document.createElement('div'); d.className = 'ck-ring';
        d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d);
        setTimeout(() => d.remove(), 600);
      }, [box.x + box.width / 2, box.y + box.height / 2]);
    } catch { /* noop */ }
  };

  const ctx = { page, ring, shot, pausa, demo: DEMO, obraDemo: OBRA_DEMO, web };
  const cues = []; // { n, texto, inicio_ms, fin_ms }

  try {
    // ── Login ──
    await page.goto(`${web}/auth`, { waitUntil: 'networkidle', timeout: 45000 });
    const conCorreo = page.getByRole('button', { name: /Con correo/i });
    if (await conCorreo.count()) await conCorreo.first().click().catch(() => {});
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(pass);
    await page.getByRole('button', { name: /Iniciar sesión/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 45000 }).catch(() => {});
    await pausa(1800);
    await dismissModales(page);

    // ── Portada (2 s) ──
    await page.evaluate(([b, k, t, s]) => window.__ck.card(b, k, t, s),
      ['Constructora SD', 'Cómo hacer', guion.titulo, guion.subtitulo || '']);
    await pausa(2200);
    await page.evaluate(() => window.__ck.quitarCard());

    // ── Barra de pasos ──
    const total = guion.pasos.length;
    await page.evaluate((n) => window.__ck.mostrarBarra(n), total);

    for (let i = 0; i < guion.pasos.length; i++) {
      const paso = guion.pasos[i];
      const inicio = Date.now() - t0;
      await page.evaluate(([n, txt]) => window.__ck.paso(n, txt), [i + 1, paso.texto]);
      await pausa(500);
      if (paso.run) await paso.run(ctx);
      await shot(`paso-${i + 1}`);
      // Candado de texto en cada paso (aborta si ve datos reales).
      assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);
      const fin = Date.now() - t0;
      cues.push({ n: i + 1, texto: paso.texto, inicio_ms: inicio, fin_ms: fin });
      await pausa(400);
    }

    // ── Cierre (2 s) ──
    await page.evaluate(() => window.__ck.ocultarBarra());
    await page.evaluate(([b, k, t, s]) => window.__ck.card(b, k, t, s),
      ['Constructora SD', 'Listo', guion.cierre || '¡Eso es todo!',
        'Encuentra esta y otras guías en Dudas.']);
    await pausa(2200);
    assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);
  } catch (e) {
    console.error('✗ error en el flujo:', e.message);
    await shot('ERROR');
    throw e;
  } finally {
    const video = await page.video();
    await context.close();
    await browser.close();
    const webm = await video.path();

    // ── ffmpeg: webm → mp4 + póster ──
    const base = `${outDir}/${guion.id}-v${version}`;
    const mp4 = `${base}.mp4`;
    const poster = `${base}.jpg`;
    const vtt = `${base}.vtt`;
    execFileSync(FFMPEG, ['-y', '-i', webm,
      '-vf', `scale=${viewport.width}:${viewport.height}:force_original_aspect_ratio=decrease,pad=${viewport.width}:${viewport.height}:(ow-iw)/2:(oh-ih)/2,fps=30`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4],
      { stdio: 'inherit' });
    execFileSync(FFMPEG, ['-y', '-i', mp4, '-frames:v', '1', '-update', '1', poster], { stdio: 'inherit' });

    // ── VTT (subtítulos = texto de cada paso) ──
    const lineas = ['WEBVTT', ''];
    for (const c of cues) {
      lineas.push(`${vttTime(c.inicio_ms)} --> ${vttTime(c.fin_ms)}`);
      lineas.push(c.texto);
      lineas.push('');
    }
    writeFileSync(vtt, lineas.join('\n'), 'utf8');

    const duracion_s = cues.length ? Math.ceil((cues[cues.length - 1].fin_ms + 2200) / 1000) : 0;
    console.log(`✓ ${mp4}`);
    console.log(`✓ ${poster}`);
    console.log(`✓ ${vtt}  (${duracion_s}s)`);
    grabarGuion._ultimo = { mp4, poster, vtt, duracion_s };
  }
  return grabarGuion._ultimo;
}

// Descarta los modales de bienvenida (políticas CI3 / idioma BS4 / tour "Bienvenido").
export async function dismissModales(page) {
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
  const cancelar = page.getByRole('button', { name: /^Cancelar$/i });
  if (await cancelar.count()) { await cancelar.first().click().catch(() => {}); await pausa(500); }
  await pausa(400);
}
