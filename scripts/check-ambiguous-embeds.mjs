// check-ambiguous-embeds.mjs — GUARDA ANTI-EMBEDS AMBIGUOS de PostgREST (corre en `prebuild`).
//
// Por qué existe (AU5(e), por fin implementado): el error
//   "Could not embed because more than one relationship was found for 'A' and 'B'"
// ya rompió el mismo módulo CUATRO veces (AN5 → AU5 → AS2 → BB5). Aparece cuando una
// migración POSTERIOR agrega una segunda FK entre dos tablas (p. ej. AZ9 metió
// proyectos.maestro_personal_id → personal_obra, ADEMÁS de personal_obra.proyecto_id →
// proyectos), y un `.select('*, proyecto:proyectos(...)')` viejo queda ambiguo: PostgREST
// ya no sabe cuál relación usar. El fix es nombrar la FK: `proyectos!proyecto_id(...)`.
//
// Este check lo hace IMPOSIBLE de reintroducir:
//   1. Construye el grafo de FKs leyendo TODO el `sql/` (create/alter table ... references).
//   2. Escanea los `.select(...)` de TODO el código TS (src + supabase/functions) y saca los
//      embeds PostgREST (`alias:tabla(...)`, `tabla(...)`, `tabla!hint(...)`).
//   3. Falla el build si un embed apunta a una tabla que tiene MÁS DE UNA relación FK con la
//      tabla de origen (en cualquier dirección) y NO está desambiguado con `!hint`.
//
// Heurística deliberadamente conservadora: solo marca un embed cuando el par (origen, destino)
// tiene ≥2 aristas FK reales en el grafo. Tokens que no son tablas (count(), max(), etc.) nunca
// forman un par con ≥2 FKs, así que no generan falsos positivos.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SQL_DIR = join(ROOT, 'sql');
const TS_ROOTS = [join(ROOT, 'src'), join(ROOT, 'supabase', 'functions')];

// ─────────────────────────────────────────────────────────────────────────────
// 1) Grafo de FKs desde el SQL
// ─────────────────────────────────────────────────────────────────────────────
// Aristas dirigidas src → dest con la columna de origen. La ambigüedad de PostgREST
// es NO dirigida: cuentan todas las FK entre el par {A,B} en ambos sentidos.

/** @typedef {{src:string, dest:string, col:string}} FkEdge */

function stripSqlComments(sql) {
  // Quita comentarios de línea `-- ...`. (Los bloques `/* */` no se usan en estas migraciones.)
  return sql
    .split('\n')
    .map((l) => {
      const i = l.indexOf('--');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
}

function normTable(name) {
  // Quita el esquema (`sgc.`) y comillas; deja el nombre desnudo en minúsculas.
  return name.replace(/^"?[a-z_][a-z0-9_]*"?\./i, '').replace(/"/g, '').toLowerCase();
}

/** @returns {FkEdge[]} */
function buildFkEdges() {
  /** @type {FkEdge[]} */
  const edges = [];
  const files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(SQL_DIR, file), 'utf8'));

    // Trocea en sentencias por `;` (suficiente: las FK viven en create/alter table,
    // que no llevan `;` internos salvo dentro de $$ ... $$ de funciones, y ahí no hay
    // `references` de DDL).
    const statements = splitTopLevelStatements(sql);

    for (const stmt of statements) {
      const lower = stmt.toLowerCase();

      // --- CREATE TABLE sgc.X ( ... col ... references sgc.Y(...) , constraint ... foreign key (col) references sgc.Y ... )
      const mCreate = stmt.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)\s*\(/i);
      if (mCreate) {
        const src = normTable(mCreate[1]);
        collectReferences(stmt, src, edges);
        continue;
      }

      // --- ALTER TABLE sgc.X ADD COLUMN ... references sgc.Y  |  ADD CONSTRAINT ... references sgc.Y
      const mAlter = stmt.match(/alter\s+table\s+(?:only\s+)?([a-z0-9_."]+)/i);
      if (mAlter && lower.includes('references')) {
        const src = normTable(mAlter[1]);
        collectReferences(stmt, src, edges);
        continue;
      }
    }
  }
  return edges;
}

// Divide en sentencias por `;` de nivel superior, ignorando los `;` dentro de cuerpos $tag$...$tag$.
function splitTopLevelStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let dollarTag = null;
  while (i < sql.length) {
    if (dollarTag) {
      // dentro de un cuerpo $tag$ ... $tag$
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += sql[i++];
      continue;
    }
    const m = /^\$[a-z0-9_]*\$/i.exec(sql.slice(i));
    if (m) {
      dollarTag = m[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (sql[i] === ';') {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += sql[i++];
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// Extrae todas las columnas que hacen `references sgc.DEST` dentro de una sentencia DDL.
function collectReferences(stmt, src, edges) {
  // (a) columna inline:  <col> <tipo...> references sgc.DEST
  //     y (b) constraint: foreign key (<col>) references sgc.DEST
  // Recorremos cada `references sgc.DEST` y tratamos de recuperar la columna a la izquierda.
  const re = /references\s+([a-z0-9_."]+)\s*(?:\(([^)]*)\))?/gi;
  let m;
  while ((m = re.exec(stmt)) !== null) {
    const dest = normTable(m[1]);
    if (!dest || dest === src) continue; // self-FK no genera ambigüedad de embed

    // Intentar nombrar la columna de origen (solo para el mensaje de ayuda).
    let col = '?';
    const before = stmt.slice(0, m.index);
    const fk = before.match(/foreign\s+key\s*\(\s*"?([a-z0-9_]+)"?\s*\)\s*$/i);
    if (fk) {
      col = fk[1];
    } else {
      // columna inline: última palabra-identificador antes de tipos/atributos.
      const inline = before.match(/([a-z0-9_]+)\s+(?:uuid|int|bigint|integer|text|smallint)[a-z0-9_ ]*$/i);
      if (inline) col = inline[1];
    }
    edges.push({ src, dest, col });
  }
}

// Mapa par-no-dirigido "a|b" (ordenado) → aristas involucradas.
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function buildPairIndex(edges) {
  const map = new Map();
  for (const e of edges) {
    const k = pairKey(e.src, e.dest);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Escaneo de embeds en el código TS
// ─────────────────────────────────────────────────────────────────────────────

function walkTs(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

// Lee un literal de string que empieza en `code[start]` (una de ' " `). Devuelve {value, end}.
function readStringLiteral(code, start) {
  const quote = code[start];
  let i = start + 1;
  let value = '';
  while (i < code.length) {
    const c = code[i];
    if (c === '\\') {
      value += code[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === quote) return { value, end: i };
    value += c;
    i++;
  }
  return { value, end: i };
}

// Extrae los embeds de nivel superior de un string de `.select(...)`.
// Devuelve [{ target, aliased, hinted }]. Ignora lo que hay dentro de paréntesis anidados
// (esas son las columnas del embed, no embeds del origen).
function extractTopLevelEmbeds(selectStr) {
  const embeds = [];
  let depth = 0;
  let i = 0;
  // token candidato: (alias:)?target(!hint)?(   evaluado solo en depth 0
  const tokenRe = /(?:([a-z0-9_]+)\s*:\s*)?([a-z0-9_]+)\s*(!\s*[a-z0-9_]+)?\s*\(/gi;
  // Recorremos manualmente controlando profundidad de paréntesis.
  while (i < selectStr.length) {
    const c = selectStr[i];
    if (c === '(') {
      // Antes de entrar, ver si justo aquí arranca un embed de nivel 0.
      if (depth === 0) {
        // buscamos hacia atrás el token que precede a este '('
        const upto = selectStr.slice(0, i + 1);
        tokenRe.lastIndex = 0;
        let m, last = null;
        while ((m = tokenRe.exec(upto)) !== null) {
          if (m.index + m[0].length === i + 1) last = m;
        }
        if (last) {
          embeds.push({
            target: last[2].toLowerCase(),
            aliased: !!last[1],
            hinted: !!last[3],
          });
        }
      }
      depth++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    }
    i++;
  }
  return embeds;
}

function offsetToLine(code, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) if (code[i] === '\n') line++;
  return line;
}

// Busca en un archivo TS los pares (fromTable, selectString) y devuelve hallazgos de embed.
function scanTsFile(file) {
  const code = readFileSync(file, 'utf8');
  const findings = [];

  // Consts string del archivo (para `.select(SELECT_QUERY)`).
  const consts = new Map();
  const constRe = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*(?::\s*string)?\s*=\s*(['"`])/g;
  let cm;
  while ((cm = constRe.exec(code)) !== null) {
    const { value } = readStringLiteral(code, cm.index + cm[0].length - 1);
    consts.set(cm[1], value);
  }

  // Posiciones de `.from('tabla')` (origen literal).
  const froms = [];
  const fromRe = /\.from\(\s*(['"`])([a-z0-9_]+)\1/gi;
  let fm;
  while ((fm = fromRe.exec(code)) !== null) {
    froms.push({ index: fm.index, table: fm[2].toLowerCase() });
  }
  const sourceForOffset = (offset) => {
    let best = null;
    for (const f of froms) if (f.index < offset && (!best || f.index > best.index)) best = f;
    return best ? best.table : null;
  };

  // Cada `.select(` con argumento string literal o identificador-const.
  const selRe = /\.select\(\s*/g;
  let sm;
  while ((sm = selRe.exec(code)) !== null) {
    const argStart = sm.index + sm[0].length;
    const ch = code[argStart];
    let selectStr = null;
    if (ch === "'" || ch === '"' || ch === '`') {
      selectStr = readStringLiteral(code, argStart).value;
    } else {
      const idm = code.slice(argStart).match(/^([A-Za-z0-9_]+)/);
      if (idm && consts.has(idm[1])) selectStr = consts.get(idm[1]);
    }
    if (!selectStr || !selectStr.includes('(')) continue;

    const src = sourceForOffset(sm.index);
    if (!src) continue; // origen no literal → no podemos evaluar ambigüedad

    const embeds = extractTopLevelEmbeds(selectStr);
    for (const emb of embeds) {
      findings.push({ file, line: offsetToLine(code, sm.index), src, ...emb });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Verificación
// ─────────────────────────────────────────────────────────────────────────────

const edges = buildFkEdges();
const pairIndex = buildPairIndex(edges);

const tsFiles = TS_ROOTS.flatMap((r) => {
  try {
    return walkTs(r, []);
  } catch {
    return [];
  }
});

const problemas = [];
let embedsRevisados = 0;

for (const file of tsFiles) {
  for (const f of scanTsFile(file)) {
    const involved = pairIndex.get(pairKey(f.src, f.target));
    if (!involved) continue; // el destino no es tabla FK-conectada al origen → no es embed FK
    embedsRevisados++;
    if (involved.length >= 2 && !f.hinted) {
      // Sugerir las columnas candidatas para el `!hint`.
      const cols = [...new Set(involved.map((e) => `${e.src}.${e.col}`))].join(' , ');
      problemas.push(
        `✗ ${relative(ROOT, f.file)}:${f.line}\n` +
          `   embed ambiguo: .from('${f.src}') … ${f.aliased ? '<alias>:' : ''}${f.target}(...)\n` +
          `   hay ${involved.length} relaciones FK entre '${f.src}' y '${f.target}': ${cols}\n` +
          `   → desambigua nombrando la FK, p. ej.  ${f.target}!<columna>(...)`
      );
    }
  }
}

if (problemas.length) {
  console.error('\n🔴 EMBEDS AMBIGUOS — build detenido (patrón AN5→AU5→AS2→BB5):\n');
  console.error(problemas.join('\n\n'));
  console.error(
    '\nPostgREST no puede resolver estos embeds y lanzará ' +
      '"Could not embed because more than one relationship was found".\n' +
      'Nombra la FK con `tabla!columna(...)` en el .select(). ' +
      `(${edges.length} FKs indexadas, ${embedsRevisados} embeds FK revisados.)\n`
  );
  process.exit(1);
}

console.log(
  `\n✓ Sin embeds ambiguos (${edges.length} FKs indexadas, ${embedsRevisados} embeds FK revisados en ${tsFiles.length} archivos TS).`
);
