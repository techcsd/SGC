// qa/visual/indice.mjs — CB v2. Construye qa/visual/cb/index.html con TODAS las
// capturas agrupadas por ruta, claro/oscuro × escritorio/móvil. Si existen dos
// carpetas (p. ej. `antes` y `despues`) las pone lado a lado para el before/after.
//
// USO:  node qa/visual/indice.mjs [antes despues]   (por defecto: todas las carpetas de cb/)

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CB = join(__dirname, 'cb');

const labels = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(CB).filter((d) => { try { return statSync(join(CB, d)).isDirectory(); } catch { return false; } });

if (!labels.length) { console.error('[indice] no hay carpetas en qa/visual/cb/'); process.exit(1); }

// Recolecta: rutas → { [label]: { 'desktop-light': file, ... } }
const rutas = new Map();
for (const label of labels) {
  let files = [];
  try { files = readdirSync(join(CB, label)).filter((f) => f.endsWith('.png')); } catch { continue; }
  for (const f of files) {
    const m = f.match(/^(.*)__(desktop|movil)__(light|dark)\.png$/);
    if (!m) continue;
    const [, ruta, vp, theme] = m;
    if (!rutas.has(ruta)) rutas.set(ruta, {});
    const r = rutas.get(ruta);
    (r[label] ??= {})[`${vp}-${theme}`] = `${label}/${f}`;
  }
}

const ordenadas = [...rutas.keys()].sort();
const modulo = (r) => (r.split('_')[0] || 'general');
const grupos = new Map();
for (const r of ordenadas) {
  const g = modulo(r);
  if (!grupos.has(g)) grupos.set(g, []);
  grupos.get(g).push(r);
}

const views = [
  ['desktop-light', 'Escritorio · claro'],
  ['desktop-dark', 'Escritorio · oscuro'],
  ['movil-light', 'Móvil · claro'],
  ['movil-dark', 'Móvil · oscuro'],
];

const cell = (ruta) => {
  let html = `<div class="ruta"><h3>${ruta.replace(/_/g, '/')}</h3>`;
  for (const [key, titulo] of views) {
    html += `<div class="view"><span class="vt">${titulo}</span><div class="imgs">`;
    for (const label of labels) {
      const src = rutas.get(ruta)?.[label]?.[key];
      html += src
        ? `<figure><figcaption>${label}</figcaption><a href="${src}" target="_blank"><img loading="lazy" src="${src}"></a></figure>`
        : `<figure class="miss"><figcaption>${label}</figcaption><div class="no">—</div></figure>`;
    }
    html += `</div></div>`;
  }
  return html + `</div>`;
};

let body = '';
for (const [g, rs] of [...grupos].sort()) {
  body += `<section><h2 id="${g}">${g} <small>(${rs.length})</small></h2>${rs.map(cell).join('')}</section>`;
}
const nav = [...grupos.keys()].sort().map((g) => `<a href="#${g}">${g}</a>`).join(' · ');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SGC — QA visual CB (${labels.join(' vs ')})</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--border:#e4e7ec;--text:#101828;--muted:#5b6b80;--navy:#1e3a5f;--accent:#f97316}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text)}
header{position:sticky;top:0;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:14px 20px;z-index:5}
header h1{margin:0 0 6px;font-size:18px}.nav{font-size:12px;color:var(--muted)}.nav a{color:var(--navy);text-decoration:none;margin-right:2px}
section{padding:8px 20px 28px}h2{position:sticky;top:64px;background:var(--bg);padding:10px 0;margin:0;border-bottom:2px solid var(--accent);font-size:16px;text-transform:capitalize}
h2 small{color:var(--muted);font-weight:400}
.ruta{margin:18px 0;padding:14px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.ruta h3{margin:0 0 10px;font-size:14px;color:var(--navy);font-family:monospace}
.view{margin-bottom:12px}.vt{font-size:12px;color:var(--muted);font-weight:600}
.imgs{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
figure{margin:0;flex:1;min-width:280px}figcaption{font-size:11px;color:var(--muted);margin-bottom:3px}
img{width:100%;border:1px solid var(--border);border-radius:10px;display:block}
.miss .no{height:120px;display:flex;align-items:center;justify-content:center;color:var(--muted);border:1px dashed var(--border);border-radius:10px}
</style></head><body>
<header><h1>SGC — QA visual rediseño CB · ${labels.join(' vs ')}</h1><div class="nav">${nav}</div></header>
${body}
</body></html>`;

writeFileSync(join(CB, 'index.html'), html);
console.log(`[indice] index.html con ${ordenadas.length} ruta(s), ${grupos.size} módulo(s), carpetas: ${labels.join(', ')}`);
