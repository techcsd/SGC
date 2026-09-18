// verify-dev-strings.mjs — GUARDA DE PRODUCTO (BS2, checklist regla 16).
//
// Por qué existe: lo que el usuario ve lo decide su ROL, no el estado del
// sistema. Un error técnico NUNCA le habla en lenguaje de desarrollador — se
// traduce (mensaje humano), se reporta a Tecnología, y el detalle técnico solo
// lo ve `es_desarrollador()` (componente `app-error-state`). El caso real: a
// Raykler le salía "Ejecuta el SQL … en el SQL Editor de Supabase" (BS2, #37).
//
// Regla: ningún TEMPLATE (`.html`) fuera de `pages/tecnologia/` y `pages/admin/`
// (superficies de desarrollador/administrador) puede contener jerga técnica de
// base de datos/infra dirigida al usuario. Si reaparece, rompe el build — como
// verify-tokens/verify-regresiones.
//
// Escape-hatch legítimo: añade `<!-- dev-strings-allow -->` en la línea.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');

// Carpetas de desarrollador/administrador: ahí SÍ se puede hablar técnico.
const EXCLUDE = [
  join('pages', 'tecnologia'),
  join('pages', 'admin'),
];

// Frases prohibidas en un template dirigido al usuario. Español e inglés.
const PROHIBIDO = [
  /SQL Editor/i,
  /\bSupabase\b/i,
  /schema cache/i,
  /ejecuta el sql/i,
  /aplica la migraci[oó]n/i,
  /migraci[oó]n correspondiente/i,
  /\bno configurad[ao]\b/i,
  /tabla .* no existe/i,
  /run the sql/i,
  // BT7 — nada de SQL crudo de Postgres en un template de usuario (regla 16).
  /violates .*constraint/i,
  /violates foreign key/i,
  /insert or update on table/i,
  /row-level security policy/i,
  /\bSQLSTATE\b/i,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC_DIR)) {
  const rel = relative(join(__dirname, '..'), file);
  if (EXCLUDE.some((e) => rel.includes(e))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/dev-strings-allow/.test(line)) return;
    for (const re of PROHIBIDO) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        break;
      }
    }
  });
}

if (violations.length) {
  console.error(
    `\n[verify-dev-strings] ✗ ${violations.length} texto(s) de desarrollador en un template de usuario ` +
      `(regla 16 / BS2). El usuario nunca lee jerga de BD/infra: usa <app-error-state> ` +
      `(mensaje por rol + reporte a Tecnología; el detalle técnico solo lo ve es_desarrollador()).\n` +
      `Si de verdad es una pantalla de desarrollador, muévela bajo pages/tecnologia|admin ` +
      `o añade "<!-- dev-strings-allow -->" a la línea.\n`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
  process.exit(1);
}

console.log('[verify-dev-strings] ✓ sin jerga técnica en templates de usuario (regla 16 / BS2).');
