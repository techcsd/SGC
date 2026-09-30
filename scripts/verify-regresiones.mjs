// verify-regresiones.mjs — GUARDA DE REGRESIÓN PERMANENTE (corre en cada `prebuild`).
//
// Por qué existe: hay bugs que ya volvieron 2+ veces porque una migración POSTERIOR
// reintrodujo, byte por byte, el filtro que otra había quitado. El bloque `DO $regtest$`
// que vive dentro de una migración solo corre UNA vez (al aplicar ESE archivo) y NO
// protege contra una migración futura. Este script sí: escanea `sql/`, toma la
// DEFINICIÓN VIVA (la del último archivo por fecha) de cada función sensible y falla
// el build/deploy si reaparece el patrón prohibido. Mismo espíritu que
// verify-version-notes.mjs (rompe el deploy si algo obligatorio falta).
//
// Añadir una nueva guarda = una entrada más en REGLAS.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, '..', 'sql');
const SRC_DIR = join(__dirname, '..', 'src');

// ── Reglas de regresión ──────────────────────────────────────────────────────
// fn      : firma completa `esquema.funcion` tal como aparece tras `create or replace function`
// forbid  : regex que NO debe aparecer en el CUERPO de la definición viva (sin comentarios)
// require : regex que SÍ debe aparecer (en la CABECERA por defecto — ver `target`)
// target  : 'body' (default) | 'header' — dónde se busca `forbid`/`require`.
//           'header' = el texto entre `create ... function` y el `$$` de apertura
//           (ahí viven `security definer`, `set search_path`, etc.).
// reason  : mensaje que se imprime al fallar (con el ID del incidente)
const REGLAS = [
  {
    fn: 'sgc.mis_conduces_pendientes_entrega',
    forbid: /es_prueba/i,
    reason:
      'AQ5/AJ8: la bandeja "Pendiente entrega" del chofer NO debe filtrar es_prueba ' +
      '(un chofer de QA opera sobre datos de prueba y son SUYOS). Regresionó en AM5. ' +
      'Ver cabecera de sql/2026-08-14-aq5-conduce-pendiente-entrega-regresion.sql.',
  },
  {
    // BC7 (PROMPT-21): la bitácora WEB reventaba con "permission denied for table
    // bitacora_catalogo_usos" porque el RPC era SECURITY INVOKER y `authenticated`
    // no tiene INSERT sobre los catálogos. La ruta APP (crear_bitacora_app) siempre
    // fue SECURITY DEFINER. Ambas deben quedarse DEFINER: es el patrón (único camino
    // de escritura, gate por `tiene_modulo`), no un grant de tabla por rol.
    fn: 'sgc.crear_entrada_bitacora',
    require: /security\s+definer/i,
    target: 'header',
    reason:
      'BC7: crear_entrada_bitacora DEBE ser SECURITY DEFINER (paridad con ' +
      'crear_bitacora_app). Si vuelve a SECURITY INVOKER, el ingeniero de campo/capataz ' +
      'no puede guardar bitácoras (falla al escribir bitacora_catalogo_usos). ' +
      'Ver sql/2026-08-29-bc7-bitacora-catalogo-usos-grant.sql.',
  },
  {
    fn: 'sgc.crear_bitacora_app',
    require: /security\s+definer/i,
    target: 'header',
    reason:
      'BC7: crear_bitacora_app DEBE seguir siendo SECURITY DEFINER (ruta de la app). ' +
      'Ver sql/2026-08-29-bc7-bitacora-catalogo-usos-grant.sql.',
  },
  // BZ2: "pendiente" del material no catalogado = SIN vincular Y SIN declinar. La única
  // fuente de verdad es sgc.item_libre_pendiente(il). Estas funciones NO deben volver a
  // usar el predicado inline `articulo_vinculado_id is null` (contaba declinados como
  // pendientes → conduces fantasma en "por implementar" y bandeja vacía). Nota #78.
  // (item_libre_pendiente() SÍ lo contiene — es su definición — y no está en esta lista.)
  ...['sgc.conduces_por_implementar', 'sgc.conduces_por_implementar_count',
      'sgc.material_no_catalogado_pendientes', 'sgc.material_no_catalogado_pendientes_count',
      'sgc.vincular_movimiento_requisiciones'].map((fn) => ({
    fn,
    forbid: /articulo_vinculado_id\s+is\s+null/i,
    reason:
      `BZ2: ${fn} debe usar sgc.item_libre_pendiente(il) (sin vincular Y sin declinar), ` +
      'no el predicado inline `articulo_vinculado_id is null` (regresó al contar los ' +
      'declinados como pendientes). Ver sql/2026-09-25-bz2-item-libre-pendiente.sql.',
  })),
];

// ── Utilidades ───────────────────────────────────────────────────────────────
function sqlFilesSorted() {
  // Los nombres empiezan con YYYY-MM-DD → orden lexicográfico == orden cronológico.
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// Extrae el cuerpo de la ÚLTIMA definición de `fn` encontrada en los archivos (la viva).
// Devuelve { file, body } o null si nunca se define.
// OJO: el matcher exige el paréntesis de apertura tras el nombre para no confundir
// `...entrega` con `...entrega_count` (una función hermana en el mismo archivo cuyo
// cuerpo NUNCA tendría el patrón prohibido → convertiría la guarda en un no-op).
function definicionViva(fn) {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marcador = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\(`, 'gi');
  let encontrada = null;
  for (const file of sqlFilesSorted()) {
    const raw = readFileSync(join(SQL_DIR, file), 'utf8');
    let m;
    while ((m = marcador.exec(raw)) !== null) {
      // El cuerpo va dollar-quoted con una etiqueta que puede ser `$$` o
      // `$function$`, `$body$`, etc. Detectamos la PRIMERA etiqueta tras el
      // create y buscamos su cierre exacto (misma etiqueta).
      const tagRe = /\$([A-Za-z_]\w*)?\$/g;
      tagRe.lastIndex = m.index;
      const open = tagRe.exec(raw);
      if (open) {
        const tag = open[0];
        const bodyStart = open.index;
        const bodyEnd = raw.indexOf(tag, bodyStart + tag.length);
        if (bodyEnd !== -1) {
          encontrada = {
            file,
            // Cabecera = del `create` hasta la etiqueta de apertura (ahí viven
            // `security definer`, `set search_path`, la firma…).
            header: raw.slice(m.index, bodyStart),
            body: raw.slice(bodyStart + tag.length, bodyEnd),
          };
        }
      }
    }
    marcador.lastIndex = 0;
  }
  return encontrada;
}

// Quita comentarios de línea (`-- ...`) para no dar falsos positivos con notas explicativas.
function sinComentarios(body) {
  return body
    .split('\n')
    .map((l) => {
      const i = l.indexOf('--');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
}

// ── Verificación ─────────────────────────────────────────────────────────────
const fallos = [];
for (const regla of REGLAS) {
  const def = definicionViva(regla.fn);
  if (!def) {
    fallos.push(`✗ ${regla.fn}: no se encontró ninguna definición en sql/ (¿se renombró la función?).`);
    continue;
  }
  const target = regla.target === 'header' ? def.header : def.body;
  const texto = sinComentarios(target);
  if (regla.forbid && regla.forbid.test(texto)) {
    fallos.push(
      `✗ REGRESIÓN en ${regla.fn} (definición viva: ${def.file}):\n` +
        `   reaparece el patrón prohibido ${regla.forbid}.\n` +
        `   ${regla.reason}`
    );
  } else if (regla.require && !regla.require.test(texto)) {
    fallos.push(
      `✗ REGRESIÓN en ${regla.fn} (definición viva: ${def.file}):\n` +
        `   falta el patrón obligatorio ${regla.require} en la ${regla.target === 'header' ? 'cabecera' : 'definición'}.\n` +
        `   ${regla.reason}`
    );
  } else {
    console.log(`✓ ${regla.fn} — sin regresión (definición viva: ${def.file}).`);
  }
}

// ── CA2 — predicado ÚNICO de visibilidad: política SELECT == RPC de lista/detalle ──
// Regla 14: una tabla con RLS de visibilidad y un RPC que lista/lee el mismo dato deben
// resolver la visibilidad con LA MISMA función `puede_ver_*`. Si divergen, un usuario ve
// la fila por un camino y no por el otro (CA2 proyectos: web amplia / app estrecha; BZ1
// combustible: lista por RPC / detalle por tabla). Se verifica sobre la definición VIVA
// (último archivo por fecha) de la política y del RPC.
const PREDICADO_UNICO = [
  { tabla: 'proyectos',             policy: 'proyectos: select',             rpc: 'sgc.mis_proyectos',    fn: 'puede_ver_proyecto',
    reason: 'CA2: la política "proyectos: select" y mis_proyectos deben usar sgc.puede_ver_proyecto ' +
      '(regla 14). Divergieron y Sócrates veía las obras en la web pero no en la app. ' +
      'Ver sql/2026-09-27-ca2-proyectos-visibilidad-unica.sql.' },
  { tabla: 'bitacoras',             policy: 'bitacoras: select',             rpc: 'sgc.listar_bitacoras', fn: 'puede_ver_bitacora_de',
    reason: 'BY4: la política "bitacoras: select" y listar_bitacoras deben usar sgc.puede_ver_bitacora_de ' +
      '(regla 14). Ver sql/2026-09-25-by4-bitacora-visibilidad.sql.' },
  { tabla: 'registros_combustible', policy: 'registros_combustible: select', rpc: 'sgc.echada_detalle',    fn: 'puede_ver_echada',
    reason: 'BZ1/CA2: la política "registros_combustible: select" y echada_detalle deben usar ' +
      'sgc.puede_ver_echada (regla 14). Ver sql/2026-09-27-ca2-proyectos-visibilidad-unica.sql.' },
  { tabla: 'mantenimientos',        policy: 'mantenimientos: select',        rpc: 'sgc.listar_mantenimientos', fn: 'puede_ver_vehiculo',
    reason: 'CD4: la política "mantenimientos: select" y listar_mantenimientos deben usar ' +
      'sgc.puede_ver_vehiculo (regla 14) — evita el patrón de dos predicados que causó el ' +
      'timeout como Edward. Ver sql/2026-09-30-cd4-visibilidad-vehiculo.sql.' },
];

// Texto VIVO de una `create policy "<nombre>"` (última definición por fecha), sin comentarios.
function politicaViva(nombre) {
  const escaped = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marcador = new RegExp(`create\\s+policy\\s+"${escaped}"[\\s\\S]*?;`, 'gi');
  let encontrada = null;
  for (const file of sqlFilesSorted()) {
    const raw = readFileSync(join(SQL_DIR, file), 'utf8');
    let m;
    while ((m = marcador.exec(raw)) !== null) encontrada = { file, text: m[0] };
    marcador.lastIndex = 0;
  }
  return encontrada;
}

for (const p of PREDICADO_UNICO) {
  const pol = politicaViva(p.policy);
  const rpc = definicionViva(p.rpc);
  const fnRe = new RegExp(`\\b${p.fn}\\b`);
  if (!pol) {
    fallos.push(`✗ ${p.tabla}: no se encontró la política "${p.policy}" en sql/.`);
  } else if (!fnRe.test(sinComentarios(pol.text))) {
    fallos.push(`✗ REGRESIÓN en la política "${p.policy}" (viva: ${pol.file}): no referencia sgc.${p.fn}.\n   ${p.reason}`);
  }
  if (!rpc) {
    fallos.push(`✗ ${p.tabla}: no se encontró el RPC ${p.rpc} en sql/.`);
  } else if (!fnRe.test(sinComentarios(rpc.body))) {
    fallos.push(`✗ REGRESIÓN en ${p.rpc} (viva: ${rpc.file}): no referencia sgc.${p.fn}.\n   ${p.reason}`);
  }
  if (pol && rpc && fnRe.test(sinComentarios(pol.text)) && fnRe.test(sinComentarios(rpc.body))) {
    console.log(`✓ ${p.tabla} — política y ${p.rpc} usan sgc.${p.fn} (predicado único).`);
  }
}

// ── BW2 — Controles CONTROLADOS sin `[value]` son "mudos" ─────────────────────
// Un componente controlado pinta lo elegido desde su input `value`/`values` y solo
// EMITE su cambio; si una plantilla enlaza el output pero NO el input, el usuario
// elige y el control sigue vacío (regresó en material-no-catalogado, BW2). Este lint
// falla el build si un `<app-*>` con su evento de cambio no recibe también su valor.
const CONTROLES = [
  { tag: 'app-articulo-picker', evento: /\(selectionChange\)/, valor: /\[value\]/, req: '[value]' },
  { tag: 'app-user-picker', evento: /\(selected\)/, valor: /\[value\]/, req: '[value]' },
  { tag: 'app-filter-select', evento: /\(valueChange\)/, valor: /\[value\]/, req: '[value]' },
  { tag: 'app-filter-select', evento: /\(valuesChange\)/, valor: /\[values\]/, req: '[values]' },
];

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function lineOf(raw, index) {
  return raw.slice(0, index).split('\n').length;
}

let controlesRevisados = 0;
for (const file of htmlFiles(SRC_DIR)) {
  const raw = readFileSync(file, 'utf8');
  for (const c of CONTROLES) {
    const tagRe = new RegExp(`<${c.tag}\\b[\\s\\S]*?>`, 'gi');
    let m;
    while ((m = tagRe.exec(raw)) !== null) {
      const tag = m[0];
      if (!c.evento.test(tag)) continue; // sin el evento no es controlado
      controlesRevisados++;
      if (!c.valor.test(tag)) {
        const rel = file.slice(file.indexOf('src'));
        fallos.push(
          `✗ CONTROL MUDO en ${rel}:${lineOf(raw, m.index)} — <${c.tag}> enlaza ${c.evento} ` +
            `pero le falta ${c.req}.\n` +
            `   BW2: un control controlado sin su valor de entrada nunca muestra lo elegido ` +
            `(el usuario cree que no seleccionó y reintenta). Añade ${c.req}.`
        );
      }
    }
  }
}

// ── BZ1 — el detalle de la echada va por RPC, no por lecturas sueltas de la tabla ──
// `registros_combustible` solo se lee directo dentro de su servicio (getAll/registrar,
// bajo RLS) y del servicio de conciliación (baseline). Cualquier `.from('registros_combustible')`
// nuevo en otro archivo debe pasar por un RPC (echada_detalle / log_combustible).
const RC_ALLOWED = ['combustible.service.ts', 'combustible-conciliacion.service.ts'];
// ── BZ2 — el predicado de "pendiente" no se hardcodea en el frontend ──
const RC_FROM_RE = /\.from\(\s*['"]registros_combustible['"]\s*\)/g;
const ILP_RE = /articulo_vinculado_id\s+is\s+null/gi;

function srcFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|html)$/.test(name)) out.push(p);
  }
  return out;
}

for (const file of srcFiles(SRC_DIR)) {
  const rel = file.slice(file.indexOf('src'));
  const base = file.split(/[\\/]/).pop();
  const raw = readFileSync(file, 'utf8');
  if (!RC_ALLOWED.includes(base)) {
    let m;
    RC_FROM_RE.lastIndex = 0;
    while ((m = RC_FROM_RE.exec(raw)) !== null) {
      fallos.push(
        `✗ BZ1 en ${rel}:${lineOf(raw, m.index)} — .from('registros_combustible') fuera de ` +
          `${RC_ALLOWED.join(' / ')}. El detalle va por el RPC echada_detalle (y la lista por ` +
          `log_combustible). Ver sql/2026-09-25-bz1-echada-detalle.sql.`
      );
    }
  }
  let m2;
  ILP_RE.lastIndex = 0;
  while ((m2 = ILP_RE.exec(raw)) !== null) {
    fallos.push(
      `✗ BZ2 en ${rel}:${lineOf(raw, m2.index)} — el predicado 'articulo_vinculado_id is null' ` +
        `no va en el frontend; el estado "pendiente" lo decide el servidor ` +
        `(sgc.item_libre_pendiente). Ver sql/2026-09-25-bz2-item-libre-pendiente.sql.`
    );
  }
}

// ── CC8 — Política `to authenticated` ⇒ GRANT del comando (curado) ────────────
// Bug CC8: bitacora_orden_detalle/firmas nacieron (bn1) con RLS + política
// `select` para authenticated pero SIN `grant select` → Postgres revisa el GRANT
// antes que la RLS → "permission denied for table" para TODO usuario de la web.
// La auditoría AUTORITATIVA (todas las tablas) vive en audit-rls-tablas-nuevas.mjs
// (necesita DB → on-demand). Aquí, en prebuild (estático), custodiamos las tablas
// donde el gap YA mordió o se creó este round: cada una debe tener su
// `grant <cmd> … to authenticated` en algún archivo de sql/. Lista curada (mismo
// espíritu que REGLAS): baseline vacío, cero falsos positivos.
const GRANTS_AUTH = [
  { tabla: 'bitacora_orden_detalle', cmds: ['select'],
    reason: 'CC8: OT reventaba con "permission denied for table bitacora_orden_detalle" ' +
      '(política select sin grant). Ver sql/2026-09-29-cc8-grants-orden-trabajo.sql.' },
  { tabla: 'bitacora_orden_firmas', cmds: ['select'],
    reason: 'CC8: gemela de la anterior (listar_ordenes_trabajo es SECURITY INVOKER). ' +
      'Ver sql/2026-09-29-cc8-grants-orden-trabajo.sql.' },
  { tabla: 'outbox_atascado_evidencia', cmds: ['select'],
    reason: 'CC7: la ficha del atascado lee la evidencia bajo RLS (es_tecnologia). ' +
      'Ver sql/2026-09-29-cc7-outbox-evidencia.sql.' },
];

// ¿Existe `grant <cmd> on … sgc.<tabla> … to … authenticated` en algún sql/?
function tieneGrantAuth(tabla, cmd) {
  const tRe = new RegExp(`sgc\\.${tabla}\\b`, 'i');
  const grantRe = /grant\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?((?:sgc\.\w+\s*,?\s*)+)\s+to\s+([a-z_,\s]+?);/gi;
  for (const file of sqlFilesSorted()) {
    const raw = readFileSync(join(SQL_DIR, file), 'utf8');
    let m;
    grantRe.lastIndex = 0;
    while ((m = grantRe.exec(raw)) !== null) {
      const privs = m[1].toLowerCase();
      const tables = m[2];
      const roles = m[3].toLowerCase();
      if (!/authenticated/.test(roles)) continue;
      if (!tRe.test(tables)) continue;
      if (/\ball\b/.test(privs) || new RegExp(`\\b${cmd}\\b`).test(privs)) return true;
    }
  }
  return false;
}

for (const g of GRANTS_AUTH) {
  for (const cmd of g.cmds) {
    if (tieneGrantAuth(g.tabla, cmd)) {
      console.log(`✓ sgc.${g.tabla} — grant ${cmd} to authenticated presente en sql/.`);
    } else {
      fallos.push(
        `✗ CC8 en sgc.${g.tabla}: falta 'grant ${cmd} … to authenticated' en sql/.\n` +
          `   Una política 'to authenticated FOR ${cmd}' sin su grant es un 403 latente ` +
          `(permission denied for table). ${g.reason}`
      );
    }
  }
}

// ── CD10 (regla 19): todo `sql/*.sql` citado en comentarios/docs existe en el repo ──
// Una escritura en prod solo es legítima si su archivo vive en `sql/` (o
// `sql/_recuperadas/` para las reconstruidas). Una cita `sql/…sql` que no resuelve a
// un archivo = migración corrida desde el scratchpad (regla 19 rota) o cita obsoleta.
let citasRevisadas = 0;
const ROOT = join(__dirname, '..');
const sqlEnRepo = new Set([
  ...readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')),
  ...(readdirSync(join(SQL_DIR, '_recuperadas'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => d.name)),
]);
// Cita en forma `sql/<archivo>.sql` (no `csd-app/sql/…`, que es del repo hermano).
const CITA_RE = /(?<![\w/])sql\/(\d{4}-\d{2}-\d{2}-[a-z0-9._-]+\.sql)/gi;
function* archivosParaEscanear(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name === '.git' || d.name === 'dist') continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) { yield* archivosParaEscanear(p); continue; }
    if (/\.(sql|md|mjs|ts)$/.test(d.name)) yield p;
  }
}
const citasFaltantes = new Map(); // basename → [archivos que la citan]
for (const dir of [SQL_DIR, join(ROOT, 'scripts'), join(ROOT, 'docs')]) {
  try {
    for (const file of archivosParaEscanear(dir)) {
      const txt = readFileSync(file, 'utf8');
      for (const m of txt.matchAll(CITA_RE)) {
        citasRevisadas++;
        const base = m[1];
        if (!sqlEnRepo.has(base)) {
          const rel = file.replace(ROOT, '').replace(/\\/g, '/');
          if (!citasFaltantes.has(base)) citasFaltantes.set(base, new Set());
          citasFaltantes.get(base).add(rel);
        }
      }
    }
  } catch { /* dir opcional */ }
}
// root *.md
for (const f of readdirSync(ROOT).filter((n) => n.endsWith('.md'))) {
  const txt = readFileSync(join(ROOT, f), 'utf8');
  for (const m of txt.matchAll(CITA_RE)) {
    citasRevisadas++;
    if (!sqlEnRepo.has(m[1])) {
      if (!citasFaltantes.has(m[1])) citasFaltantes.set(m[1], new Set());
      citasFaltantes.get(m[1]).add('/' + f);
    }
  }
}
if (citasFaltantes.size) {
  for (const [base, files] of citasFaltantes) {
    fallos.push(
      `✗ CD10 (regla 19): se cita 'sql/${base}' pero no existe en sql/ ni sql/_recuperadas/.\n` +
        `   Citada en: ${[...files].join(', ')}\n` +
        `   Toda migración/corrección de datos en prod vive en sql/ y el ledger — nada desde el scratchpad.\n` +
        `   Si se aplicó históricamente sin archivo, reconstrúyela en sql/_recuperadas/.`
    );
  }
}

if (fallos.length) {
  console.error('\n🔴 GUARDA DE REGRESIÓN — build detenido:\n');
  console.error(fallos.join('\n\n'));
  console.error('\nCorrige la migración/plantilla que reintrodujo el patrón antes de desplegar.\n');
  process.exit(1);
}

console.log(`\n✓ Guarda de regresión OK (${REGLAS.length} regla(s) SQL + ${controlesRevisados} control(es) + ${citasRevisadas} cita(s) sql/ verificada(s)).`);
