// verify-no-ai-tropes.mjs — GUARDA DE DISEÑO (CB v2). Corre en cada `prebuild`.
//
// Por qué existe: el rediseño CB pide un look moderno que NO "parezca hecho por
// IA". Los tropos prohibidos (CONTEXTO-35 §A/§B, Regla 5):
//   1) Degradados de FONDO en páginas/tarjetas/secciones/body (permitidos en
//      gráficas y skeleton, que los usan legítimamente).
//   2) Borde IZQUIERDO de color ≥3px en tarjetas (el clásico "card con barrita").
//   3) Emoji como icono en plantillas *.html (fuera de contenido de chat/sticker).
//
// Estrategia (idéntica a verify-regresiones): baseline con lo que EXISTE hoy; el
// guard solo FALLA si aparece una violación NUEVA. Para bajar el baseline tras
// limpiar, corre `SGC_TROPES_UPDATE=1 node scripts/verify-no-ai-tropes.mjs`.
// Escape por línea: comentario `tropes-allow`.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const BASELINE = join(__dirname, 'no-ai-tropes.baseline.json');
const ALLOW = /tropes-allow/;

// Archivos donde los degradados son legítimos (gráficas, skeleton shimmer).
const GRADIENT_OK_FILE = /(bar-chart|donut-chart|chart|skeleton|sparkline)/i;
// Selector de fondo prohibido para degradado.
const BG_SELECTOR = /(^|[\s.>])(card|page|section)|\bpage-|\bsection\b|(^|[\s])(body|html)\b|\.sgc-card|\.kpi/i;
// Plantillas de chat/sticker donde el emoji ES contenido, no icono.
const EMOJI_CONTENT_FILE = /(mensaj|chat|compa|asistente|sticker|emoji|dudas)/i;

const GRADIENT = /\b(linear|radial|conic)-gradient\s*\(/i;
const BG_DECL = /\bbackground(?:-image|-color)?\s*:/i;
const BORDER_LEFT = /border-left\s*:\s*([^;{}]+)/i;
const EMOJI = /\p{Extended_Pictographic}/u;

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// Selector que encierra la línea `idx` (busca hacia atrás la línea con `{`).
function enclosingSelector(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 40; i--) {
    const l = lines[i];
    const brace = l.indexOf('{');
    if (brace >= 0) return l.slice(0, brace);
  }
  return '';
}

const violations = [];

// ── 1 + 2: SCSS (gradientes de fondo, border-left de color) ──────────────────
for (const file of walk(SRC_DIR, ['.scss'])) {
  // Ruta SIEMPRE con '/' → la firma del baseline es estable entre Windows y el
  // Linux de Vercel (si no, `relative` mete '\' en local y todo sale "nuevo" en CI).
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (GRADIENT_OK_FILE.test(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    // 1) degradado en background de card/page/section/body
    if (GRADIENT.test(line) && BG_DECL.test(line)) {
      const sel = enclosingSelector(lines, i);
      if (BG_SELECTOR.test(sel)) {
        violations.push({ file: rel, line: i + 1, kind: 'gradient-bg', text: line.trim().slice(0, 90) });
      }
    }
    // 2) border-left ≥3px con color en una tarjeta
    const bl = line.match(BORDER_LEFT);
    if (bl && !/border-left-(width|style|color)/.test(line)) {
      const val = bl[1];
      const px = val.match(/(\d+(?:\.\d+)?)px/);
      const hasColor = /#|rgb|hsl|var\(--/.test(val) && !/transparent|none/.test(val);
      const sel = enclosingSelector(lines, i);
      if (px && parseFloat(px[1]) >= 3 && hasColor && /card|kpi|panel|tile/i.test(sel)) {
        violations.push({ file: rel, line: i + 1, kind: 'card-border-left', text: line.trim().slice(0, 90) });
      }
    }
  });
}

// ── 3: emoji-icono en plantillas HTML ────────────────────────────────────────
for (const file of walk(SRC_DIR, ['.html'])) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (EMOJI_CONTENT_FILE.test(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    if (EMOJI.test(line)) {
      const chars = [...line].filter((c) => EMOJI.test(c)).join('');
      violations.push({ file: rel, line: i + 1, kind: 'emoji', text: chars });
    }
  });
}

// Firma estable por violación (kind + archivo + texto; NO la línea, que cambia).
const sig = (v) => `${v.kind}::${v.file}::${v.text}`;
const current = new Set(violations.map(sig));

if (process.env.SGC_TROPES_UPDATE === '1' || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify([...current].sort(), null, 2) + '\n');
  console.log(`[verify-no-ai-tropes] baseline escrito con ${current.size} entradas (grandfathered).`);
  process.exit(0);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')));
const nuevas = violations.filter((v) => !baseline.has(sig(v)));

if (nuevas.length) {
  console.error(
    `\n[verify-no-ai-tropes] ✗ ${nuevas.length} tropo(s) NUEVO(s) "hecho por IA" — corrige o justifica con "tropes-allow".\n` +
      `  · degradado de fondo → usa un color sólido de token\n` +
      `  · border-left de color en tarjeta → usa un chip/badge de estado\n` +
      `  · emoji como icono → SVG de trazo (AW12)\n`,
  );
  for (const v of nuevas) console.error(`  [${v.kind}] ${v.file}:${v.line}  ${v.text}`);
  console.error('\n  (Si limpiaste tropos viejos y quieres bajar el baseline: SGC_TROPES_UPDATE=1 npm run …)\n');
  process.exit(1);
}

console.log(`[verify-no-ai-tropes] ✓ sin tropos nuevos (${baseline.size} en baseline).`);
