// verify-returns-table-casts.mjs — CQ5 (16-oct-2026, ver sql/2026-10-16-cq3-audit-log-listado-text.sql)
//
// Bug real encontrado: `sgc.audit_log_listado` declaraba `actor_nombre text`
// pero el `return query select` devolvía `a.nombre` (sgc.usuarios.nombre es
// `character varying`, no `text`) sin `::text` → Postgres revienta en runtime
// con "structure of query does not match function result type". Mismo defecto
// ya arreglado antes en `auditoria_actores` (CD2, 30-sep-2026) — se repitió
// porque nadie lo atrapaba en CI.
//
// Por qué SOLO plpgsql: las funciones LANGUAGE sql reciben una coerción
// automática varchar→text del planner (assignment cast) al construir el
// resultado — por eso decenas de funciones `LANGUAGE sql` del repo tienen el
// mismo patrón `u.nombre as solicitante_nombre` sin romperse nunca. Las
// funciones LANGUAGE plpgsql con `return query select ...` NO reciben esa
// coerción (el tuplestore exige coincidencia exacta de tipos) — por eso el
// barrido solo vigila plpgsql.
//
// Heurística ESTÁTICA (no hay acceso a la DB en prebuild): se vigila una lista
// de columnas que, en este esquema, son `character varying` en sus tablas base
// (confirmado por consulta a information_schema el 16-oct-2026 — ver
// sql/2026-10-16-cq3-audit-log-listado-text.sql). Si una migración nueva
// declara esa columna `text` en un `returns table(...)` de una función
// LANGUAGE plpgsql y la alimenta con `alias.columna` sin `::text` dentro de un
// `return query select`, se avisa. Falsos positivos posibles (si el alias en
// realidad apunta a una tabla donde esa columna SÍ es `text`, p. ej.
// `p.nombre` de `proyectos`) — usa EXCLUSIONES abajo.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL_DIR = join(process.cwd(), 'sql');

// Columnas confirmadas `character varying`/`name` en sus tablas base (16-oct-2026).
// Si se agrega una tabla/columna nueva con este patrón, súmala aquí.
const VARCHAR_COLS = new Set(['nombre', 'email', 'codigo', 'telefono']);

// alias.columna que NO hay que marcar aunque matcheen (tabla confirmada `text`,
// o caso revisado y descartado a mano). Formato: "archivo.sql::funcion::outcol".
const EXCLUSIONES = new Set([
  // Historial: el bug REAL de audit_log_listado (usuarios.nombre, varchar) —
  // el archivo viejo se queda tal cual como registro histórico; la definición
  // viva ya está arreglada por sql/2026-10-16-cq3-audit-log-listado-text.sql.
  '2026-08-26-az10-audit-log-listado.sql::audit_log_listado::actor_nombre',
  '2026-08-26-az10-audit-log-listado.sql::audit_log_listado::target_nombre',
  // Falso positivo: aquí el alias "p" es sgc.proyectos (no una tabla con
  // columna `nombre` varchar) — proyectos.nombre YA es `text` (confirmado por
  // information_schema el 16-oct-2026), así que no hace falta cast.
  '2026-09-04-bj1-bitacoras-cobertura.sql::bitacoras_cobertura::obra',
]);

function extraerFunciones(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:sgc|public)\.(\w+)\s*\([^)]*\)[\s\S]*?\$(?:function\$|\$)([\s\S]*?)\$(?:function\$|\$)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    out.push({ nombre: m[1], completo: m[0], cuerpo: m[2] });
  }
  return out;
}

function aliasMap(completo) {
  const map = {};
  const re = /\b(?:from|join)\s+(?:(\w+)\.)?(\w+)\s+(?:as\s+)?([a-zA-Z_]\w*)\b/gi;
  let m;
  while ((m = re.exec(completo))) {
    const [, , tabla, alias] = m;
    if (['on', 'where', 'select', 'order', 'group', 'using'].includes(alias.toLowerCase())) continue;
    map[alias] = tabla;
  }
  return map;
}

const offenders = [];
let files;
try {
  files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
} catch {
  console.log('verify-returns-table-casts: no existe sql/, nada que revisar.');
  process.exit(0);
}

for (const file of files) {
  const sql = readFileSync(join(SQL_DIR, file), 'utf8');
  if (!/language\s+plpgsql/i.test(sql) || !/returns\s+table/i.test(sql)) continue;
  for (const fn of extraerFunciones(sql)) {
    if (!/language\s+plpgsql/i.test(fn.completo)) continue;
    if (!/return\s+query/i.test(fn.cuerpo)) continue;
    const retMatch = fn.completo.match(/returns\s+table\s*\(([^)]*)\)/is);
    if (!retMatch) continue;
    const textCols = new Set([...retMatch[1].matchAll(/(\w+)\s+text\b/gi)].map((m2) => m2[1].toLowerCase()));
    if (!textCols.size) continue;
    const aliases = aliasMap(fn.completo);
    const selRe = /([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*(?:::\w+)?\s+as\s+([a-zA-Z_]\w*)/gi;
    let m;
    while ((m = selRe.exec(fn.cuerpo)) !== null) {
      const [full, alias, col, outcol] = m;
      if (!textCols.has(outcol.toLowerCase())) continue;
      if (/::text/i.test(full) || /::\w+/i.test(full)) continue; // ya tiene algún cast
      if (!VARCHAR_COLS.has(col.toLowerCase())) continue;
      if (!aliases[alias]) continue; // alias desconocido (no es from/join de tabla) — no se puede confirmar
      const key = `${file}::${fn.nombre}::${outcol}`;
      if (EXCLUSIONES.has(key)) continue;
      offenders.push({ file, funcion: fn.nombre, outcol, fuente: `${alias}.${col}`, tabla: aliases[alias] });
    }
  }
}

if (!offenders.length) {
  console.log('✓ verify-returns-table-casts: ninguna función plpgsql returns-table con varchar sin ::text.');
  process.exit(0);
}

console.error('\n✗ verify-returns-table-casts — posible "structure of query does not match function result type" (CQ5):\n');
for (const o of offenders) {
  console.error(`   · ${o.file} → sgc.${o.funcion}(): columna "${o.outcol}" viene de ${o.fuente} (tabla ${o.tabla}.${o.fuente.split('.')[1]} es character varying) sin ::text`);
}
console.error(
  '\nLas funciones LANGUAGE plpgsql con `return query select` exigen tipos EXACTOS (sin coerción automática).\n' +
  'Agrega ::text a la expresión, o si el alias en realidad NO apunta a esa tabla, súmalo a EXCLUSIONES en este script.\n' +
  'Ver sql/2026-10-16-cq3-audit-log-listado-text.sql para el caso real que originó esta regla.\n',
);
process.exit(1);
