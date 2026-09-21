// scripts/lib/edge-files.mjs — BU1 — utilidades compartidas por deploy-edge.mjs y
// backfill-ledger.mjs para que el CHECKSUM de una edge sea idéntico en ambos
// (si difiriera, deploy-edge --env prod nunca encontraría la entrada del ledger dev).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

export const FN_ROOT = 'supabase/functions';

export function verifyJwtMap() {
  const toml = readFileSync('supabase/config.toml', 'utf8');
  const map = {};
  const re = /\[functions\.([a-z0-9-]+)\]\s*\r?\n\s*verify_jwt\s*=\s*(true|false)/gi;
  let m;
  while ((m = re.exec(toml))) map[m[1]] = m[2] === 'true';
  return map;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|js|json)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Archivos que componen una edge: su carpeta (recursiva) + _shared/** si se importa. */
export function collectFiles(slug) {
  const dir = join(FN_ROOT, slug);
  if (!existsSync(dir)) throw new Error(`no existe la función ${slug}`);
  const files = walk(dir);
  const usaShared = files.some((f) => /['"][^'"]*_shared\//.test(readFileSync(f, 'utf8')));
  const sharedDir = join(FN_ROOT, '_shared');
  if (usaShared && existsSync(sharedDir)) walk(sharedDir, files);
  return files;
}

/** Checksum estable de una edge (paths relativos ordenados + contenido). */
export function checksumEdge(slug) {
  const files = collectFiles(slug);
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    h.update(relative(FN_ROOT, f).replace(/\\/g, '/'));
    h.update('\0');
    // Normaliza fin de línea (git autocrlf) para checksum estable dev↔prod.
    h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
  }
  return { checksum: h.digest('hex'), files };
}

export function listSlugs() {
  return readdirSync(FN_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort();
}
