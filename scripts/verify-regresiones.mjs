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

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, '..', 'sql');

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

if (fallos.length) {
  console.error('\n🔴 GUARDA DE REGRESIÓN — build detenido:\n');
  console.error(fallos.join('\n\n'));
  console.error('\nCorrige la migración que reintrodujo el patrón antes de desplegar.\n');
  process.exit(1);
}

console.log(`\n✓ Guarda de regresión OK (${REGLAS.length} regla(s)).`);
