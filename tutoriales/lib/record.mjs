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
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDev, assertTextoLimpio } from './privacy-lock.mjs';
import { sintetizar, hayLlaveAzure } from './voz.mjs';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

// CM3 — duración (ms) de un audio, parseando la salida de ffmpeg (-i no produce stdout).
function audioDurMs(file) {
  try { execFileSync(FFMPEG, ['-i', file], { stdio: 'pipe' }); } catch (e) {
    const m = String(e.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4]) * 10;
  }
  return 2000;
}
// CM3 — una pista de música al azar (determinista por id) de assets/musica/.
function pistaMusica(seed) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'musica');
  if (!existsSync(dir)) return null;
  const mp3 = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'));
  if (!mp3.length) return null;
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return resolve(dir, mp3[h % mp3.length]);
}

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

// ── Capa "director": cursor que se desliza, zoom/close-up, spotlight, barra de
//    pasos animada, portada/cierre con movimiento. Todo se anima en el navegador
//    (60fps) y lo captura Playwright. app-root se escala para el zoom; los overlays
//    son hijos de <body> (hermanos de app-root) para no escalarse. ────────────────
const OVERLAY_CSS = `
:root{--ckz:1;--ckx:50%;--cky:50%}
app-root{transition:transform .75s cubic-bezier(.4,.0,.2,1);transform-origin:var(--ckx) var(--cky);will-change:transform}
html.ck-zoom app-root{transform:scale(var(--ckz))}
html,body{overflow:hidden !important}

/* Cursor que se desliza hacia el objetivo */
#ck-cur{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;width:30px;height:30px;
  filter:drop-shadow(0 3px 6px rgba(0,0,0,.45));transform:translate(-4px,-2px);
  transition:left .62s cubic-bezier(.22,.61,.36,1),top .62s cubic-bezier(.22,.61,.36,1);opacity:0}
#ck-cur.on{opacity:1}
#ck-cur svg{width:100%;height:100%}

/* Pulso de clic */
.ck-pulse{position:fixed;z-index:2147483645;width:26px;height:26px;border-radius:50%;
  background:${CB.naranja}66;border:2px solid ${CB.naranja};transform:translate(-50%,-50%);pointer-events:none;animation:ckp .55s ease-out forwards}
@keyframes ckp{from{opacity:1;transform:translate(-50%,-50%) scale(.3)}to{opacity:0;transform:translate(-50%,-50%) scale(2.4)}}

/* Spotlight: oscurece todo menos el rectángulo enfocado */
#ck-spot{position:fixed;z-index:2147483644;pointer-events:none;border-radius:14px;
  box-shadow:0 0 0 9999px rgba(14,23,38,.55);border:2px solid ${CB.naranja};
  opacity:0;transition:left .5s ease,top .5s ease,width .5s ease,height .5s ease,opacity .35s ease}
#ck-spot.on{opacity:1}

/* Anillo legacy */
.ck-ring{position:fixed;z-index:2147483646;width:48px;height:48px;border:3px solid ${CB.naranja};border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;animation:ckr .6s ease-out}
@keyframes ckr{from{opacity:1;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}

/* Barra de pasos (caption animado) */
#ck-bar{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147483645;
  background:${CB.navy}f0;color:${CB.texto};backdrop-filter:blur(4px);
  font-family:'Inter',system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:18px;
  padding:16px 30px;border-radius:18px;max-width:min(1200px,86vw);
  box-shadow:0 14px 48px rgba(0,0,0,.4);transition:opacity .4s ease,transform .4s ease}
#ck-bar.hide{opacity:0;transform:translateX(-50%) translateY(20px)}
#ck-bar .ck-n{flex:0 0 auto;width:42px;height:42px;border-radius:50%;background:${CB.naranja};
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;box-shadow:0 4px 14px ${CB.naranja}66}
#ck-bar .ck-txt{flex:1 1 auto;font-size:27px;font-weight:600;line-height:1.25}
#ck-bar .ck-txt.swap{animation:cktx .45s cubic-bezier(.22,.61,.36,1)}
@keyframes cktx{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
#ck-bar .ck-prog{flex:0 0 auto;font-size:15px;opacity:.8;font-variant-numeric:tabular-nums}
#ck-bar .ck-fill{position:absolute;left:14px;right:14px;bottom:8px;height:3px;border-radius:3px;background:#ffffff22;overflow:hidden}
#ck-bar .ck-fill::after{content:'';position:absolute;left:0;top:0;height:100%;width:var(--p,0%);background:${CB.naranja};transition:width .5s ease;border-radius:3px}

/* Portada / cierre con movimiento */
#ck-card{position:fixed;inset:0;z-index:2147483647;color:${CB.texto};
  background:radial-gradient(130% 130% at 20% 0%, #27507f 0%, ${CB.navy} 55%, #122338 100%);
  font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;overflow:hidden}
#ck-card::before{content:'';position:absolute;width:520px;height:520px;border-radius:50%;
  background:radial-gradient(circle, ${CB.naranja}33 0%, transparent 70%);top:-160px;right:-120px;animation:ckfloat 6s ease-in-out infinite alternate}
@keyframes ckfloat{from{transform:translate(0,0)}to{transform:translate(-40px,40px)}}
#ck-card>*{position:relative;z-index:1;opacity:0;animation:ckup .6s cubic-bezier(.22,.61,.36,1) forwards}
#ck-card .ck-brand{font-size:20px;letter-spacing:.16em;text-transform:uppercase;opacity:.75;animation-delay:.05s}
#ck-card .ck-k{display:inline-block;font-size:17px;color:#fff;font-weight:700;letter-spacing:.05em;
  background:${CB.naranja};padding:6px 16px;border-radius:999px;animation-delay:.18s}
#ck-card .ck-h{font-size:56px;font-weight:800;max-width:74%;line-height:1.08;animation-delay:.32s}
#ck-card .ck-sub{font-size:23px;opacity:.85;max-width:62%;animation-delay:.46s}
@keyframes ckup{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
`;

const OVERLAY_JS = `
window.__ck = {
  bar: null, total: 1,
  ensureCursor(){
    if(document.getElementById('ck-cur')) return;
    const c=document.createElement('div'); c.id='ck-cur';
    c.innerHTML='<svg viewBox="0 0 24 24" fill="#fff" stroke="${CB.navy}" stroke-width="1.5" stroke-linejoin="round"><path d="M5 3l15 9-6 1.6L11 20z"/></svg>';
    document.body.appendChild(c);
  },
  cursorA(x,y){ this.ensureCursor(); const c=document.getElementById('ck-cur'); c.classList.add('on'); c.style.left=x+'px'; c.style.top=y+'px'; },
  cursorOff(){ const c=document.getElementById('ck-cur'); if(c) c.classList.remove('on'); },
  pulso(x,y){ const p=document.createElement('div'); p.className='ck-pulse'; p.style.left=x+'px'; p.style.top=y+'px'; document.body.appendChild(p); setTimeout(()=>p.remove(),600); },
  spot(x,y,w,h,pad){ pad=pad||12; let s=document.getElementById('ck-spot');
    if(!s){ s=document.createElement('div'); s.id='ck-spot'; document.body.appendChild(s); }
    s.style.left=(x-pad)+'px'; s.style.top=(y-pad)+'px'; s.style.width=(w+pad*2)+'px'; s.style.height=(h+pad*2)+'px';
    requestAnimationFrame(()=>s.classList.add('on')); },
  spotOff(){ const s=document.getElementById('ck-spot'); if(s) s.classList.remove('on'); },
  zoom(xpct,ypct,scale){ document.documentElement.style.setProperty('--ckx',xpct+'%'); document.documentElement.style.setProperty('--cky',ypct+'%'); document.documentElement.style.setProperty('--ckz',scale); document.documentElement.classList.add('ck-zoom'); },
  zoomOff(){ document.documentElement.style.setProperty('--ckz',1); document.documentElement.classList.remove('ck-zoom'); },
  mostrarBarra(total){
    if (this.bar) return;
    const b = document.createElement('div'); b.id='ck-bar';
    b.innerHTML = '<div class="ck-n">1</div><div class="ck-txt"></div><div class="ck-prog"></div><div class="ck-fill"></div>';
    document.body.appendChild(b); this.bar=b; this.total=total;
  },
  paso(n, texto){
    if(!this.bar) return;
    this.bar.querySelector('.ck-n').textContent = n;
    const t=this.bar.querySelector('.ck-txt'); t.textContent = texto;
    t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
    this.bar.querySelector('.ck-prog').textContent = n + ' / ' + this.total;
    this.bar.querySelector('.ck-fill').style.setProperty('--p', Math.round((n/this.total)*100) + '%');
  },
  ocultarBarra(){ if(this.bar){ this.bar.classList.add('hide'); } },
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

  const VW = viewport.width, VH = viewport.height;
  const centro = (b) => [b.x + b.width / 2, b.y + b.height / 2];

  const ring = async (locator) => {
    try {
      const box = await locator.boundingBox();
      if (box) await page.evaluate(([x, y]) => {
        const d = document.createElement('div'); d.className = 'ck-ring';
        d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d);
        setTimeout(() => d.remove(), 600);
      }, centro(box) ? [box.x + box.width / 2, box.y + box.height / 2] : [0, 0]);
    } catch { /* noop */ }
  };

  // Mueve el cursor-director al centro del elemento (se desliza solo).
  const mover = async (locator) => {
    try { const b = await locator.first().boundingBox(); if (b) await page.evaluate(([x, y]) => window.__ck.cursorA(x, y), centro(b)); } catch { /* noop */ }
  };

  // Enfoca un elemento: cursor + spotlight (+ close-up opcional). Deja el foco puesto.
  const foco = async (locator, { zoom = 1, pad = 12 } = {}) => {
    try {
      const l = locator.first();
      await l.scrollIntoViewIfNeeded().catch(() => {});
      let b = await l.boundingBox(); if (!b) return;
      await page.evaluate(([x, y]) => window.__ck.cursorA(x, y), centro(b));
      if (zoom > 1) {
        const cx = Math.max(8, Math.min(92, ((b.x + b.width / 2) / VW) * 100));
        const cy = Math.max(8, Math.min(92, ((b.y + b.height / 2) / VH) * 100));
        await page.evaluate(([x, y, s]) => window.__ck.zoom(x, y, s), [cx, cy, zoom]);
        await pausa(820); // deja terminar la transición de zoom
        b = await l.boundingBox() || b; // recalcula en coords ya escaladas
        await page.evaluate(([x, y]) => window.__ck.cursorA(x, y), centro(b));
      }
      await page.evaluate(([x, y, w, h, p]) => window.__ck.spot(x, y, w, h, p), [b.x, b.y, b.width, b.height, pad]);
    } catch { /* noop */ }
  };

  const desfoco = async ({ zoom = true } = {}) => {
    await page.evaluate((z) => { window.__ck.spotOff(); if (z) window.__ck.zoomOff(); }, zoom).catch(() => {});
    await pausa(zoom ? 780 : 320);
  };

  const pulso = async (locator) => {
    try { const b = await locator.first().boundingBox(); if (b) await page.evaluate(([x, y]) => window.__ck.pulso(x, y), centro(b)); } catch { /* noop */ }
  };

  // Click "guiado": enfoca, pulso, click real.
  const click = async (locator, { zoom = 1 } = {}) => {
    const l = locator.first();
    await foco(l, { zoom });
    await pausa(360);
    await pulso(l);
    await pausa(160);
    await l.click({ timeout: 8000 }).catch(() => {});
  };

  // Escribe con efecto de tecleo (enfoca el campo primero).
  const escribir = async (locator, texto, { zoom = 1 } = {}) => {
    const l = locator.first();
    await foco(l, { zoom });
    await pausa(300);
    await l.click({ timeout: 8000 }).catch(() => {});
    await l.pressSequentially(String(texto), { delay: 55 }).catch(() => { l.fill(String(texto)).catch(() => {}); });
  };

  const ctx = { page, ring, mover, foco, desfoco, pulso, click, escribir, shot, pausa, demo: DEMO, obraDemo: OBRA_DEMO, web, viewport };
  const cues = []; // { n, texto, inicio_ms, fin_ms }
  const voces = []; // CM3 — { file, durMs, inicio_ms } por paso (o null)
  let borradorVoz = false;

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

    // ── CM3 — voz por paso (Azure es-DO), pre-sintetizada para calzar el tiempo ──
    for (const paso of guion.pasos) {
      const texto = (paso.voz || paso.texto || '').trim();
      if (!texto) { voces.push(null); continue; }
      try {
        const { file, borrador } = await sintetizar(texto);
        borradorVoz = borradorVoz || !!borrador;
        voces.push({ file, durMs: audioDurMs(file), inicio_ms: 0 });
      } catch (e) { console.error('  voz falló (sigo sin audio en ese paso):', e.message); voces.push(null); }
    }

    // ── Barra de pasos ──
    const total = guion.pasos.length;
    await page.evaluate((n) => window.__ck.mostrarBarra(n), total);

    for (let i = 0; i < guion.pasos.length; i++) {
      const paso = guion.pasos[i];
      const inicio = Date.now() - t0;
      if (voces[i]) voces[i].inicio_ms = inicio; // la voz entra cuando aparece el paso
      await page.evaluate(([n, txt]) => window.__ck.paso(n, txt), [i + 1, paso.texto]);
      const pasoStart = Date.now();
      await pausa(500);
      if (paso.run) await paso.run(ctx);
      await shot(`paso-${i + 1}`);
      // Candado de texto en cada paso (aborta si ve datos reales).
      assertTextoLimpio(await page.evaluate(() => document.body.innerText), DEMO);
      // CM3 — el paso dura al menos lo que dura su voz + 0,4s (la voz nunca se corta).
      const voiceNeed = voces[i] ? voces[i].durMs + 400 : 0;
      const elapsed = Date.now() - pasoStart;
      await pausa(Math.max(400, voiceNeed - elapsed));
      const fin = Date.now() - t0;
      cues.push({ n: i + 1, texto: paso.texto, inicio_ms: inicio, fin_ms: fin });
      // Suelta el foco/zoom hacia el siguiente paso (transición suave de pull-back).
      await page.evaluate(() => { window.__ck.spotOff(); window.__ck.zoomOff(); }).catch(() => {});
      await pausa(260);
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

    // ── ffmpeg: webm → mp4 (video, sin audio aún) ──
    const base = `${outDir}/${guion.id}-v${version}`;
    const mp4 = `${base}.mp4`;
    const vid = `${base}.vid.mp4`;
    const poster = `${base}.jpg`;
    const vtt = `${base}.vtt`;
    execFileSync(FFMPEG, ['-y', '-i', webm,
      '-vf', `scale=${viewport.width}:${viewport.height}:force_original_aspect_ratio=decrease,pad=${viewport.width}:${viewport.height}:(ow-iw)/2:(oh-ih)/2,fps=30`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', vid],
      { stdio: 'inherit' });

    // ── CM3 — pista de audio: voz por paso (adelay a su tiempo) + música con ducking ──
    const conVoz = voces.filter((v) => v && v.file);
    const musica = pistaMusica(guion.id);
    if (conVoz.length) {
      const inputs = [];
      conVoz.forEach((v) => inputs.push('-i', v.file));
      if (musica) inputs.push('-i', musica);
      const fc = [];
      // input 0 = vídeo (sin audio); las voces son inputs 1..N; la música es N+1.
      conVoz.forEach((v, k) => fc.push(`[${k + 1}:a]adelay=${v.inicio_ms}|${v.inicio_ms}[v${k}]`));
      const vlabels = conVoz.map((_, k) => `[v${k}]`).join('');
      fc.push(`${vlabels}amix=inputs=${conVoz.length}:dropout_transition=0:normalize=0[vozraw]`);
      let outLabel = '[vozraw]';
      if (musica) {
        const mIdx = conVoz.length + 1;
        // [vozraw] se usa 2 veces (como key del ducking y en la mezcla) → asplit.
        fc.push(`[vozraw]asplit=2[vozA][vozB]`);
        fc.push(`[${mIdx}:a]aloop=loop=-1:size=2e9,volume=0.20[mus0]`);
        fc.push(`[mus0][vozB]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=400[musd]`);
        fc.push(`[vozA][musd]amix=inputs=2:dropout_transition=0:normalize=0[mix]`);
        outLabel = '[mix]';
      }
      fc.push(`${outLabel}loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
      execFileSync(FFMPEG, ['-y', '-i', vid, ...inputs,
        '-filter_complex', fc.join(';'),
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
        '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    } else {
      execFileSync(FFMPEG, ['-y', '-i', vid, '-c', 'copy', mp4], { stdio: 'inherit' });
    }
    try { require('node:fs').unlinkSync(vid); } catch { /* noop */ }
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
    if (borradorVoz) console.log('  ⚠️ VOZ BORRADOR (edge-tts): NO subir a prod — falta la llave de Azure.');
    else if (voces.some((v) => v)) console.log(`  🎙️ voz es-DO + ${pistaMusica(guion.id) ? 'música' : 'sin música'}`);
    grabarGuion._ultimo = { mp4, poster, vtt, duracion_s, borradorVoz };
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
