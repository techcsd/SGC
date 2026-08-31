// evals-compa.mjs — SUITE DE EVALS DE COMPA (BB4 §7). Corre en `prebuild` y en cada
// cambio del asistente. Cubre los 4 FALLOS REALES de las capturas del 29-ago:
//   1. "almacén central" → debe ELEGIR Bodega Central (no preguntar).            [BB1]
//   2. "acabo de consultarlo" SIN tool call → el validador debe dispararse.       [BB4]
//   3. doble conduce → la misma intención produce UNA sola clave idem.            [BB3]
//   4. identidad → existe la tool `quien_soy` (verificación en vivo por request). [BB4]
//
// Dos capas:
//   (A) Unit tests deterministas de los contratos de CÓDIGO (router, validador,
//       idempotencia) — replican la lógica exacta del edge y la ejercitan offline.
//   (B) Guards de FUENTE: leen supabase/functions/assistant/index.ts y confirman que
//       las técnicas del research siguen cableadas (no se puede borrar sin romper CI).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'supabase', 'functions', 'assistant', 'index.ts');

const fails = [];
const ok = [];
function check(nombre, cond, detalle = '') {
  if (cond) ok.push(nombre);
  else fails.push(`✗ ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) Contratos de código — réplica de la lógica del edge (BB1-BB4)
// ─────────────────────────────────────────────────────────────────────────────

// Router de intención (BB4.2) — mismo patrón que index.ts `INTENCION_DATOS`.
const INTENCION_DATOS =
  /\b(mi rol|mis? roles?|mis? permisos?|tengo acceso|puedo (ver|entrar|acceder)|qui[eé]n soy|con qui[eé]n hablas|qu[eé] hora|qu[eé] d[ií]a|cu[aá]nto|cu[aá]ntos|cu[aá]ntas|mira|verifica|consulta|revisa|checa|chequea|mu[eé]strame|ens[eé][ñn]ame|lista|list[aá]me|dame|cu[aá]les son|mis? (obras?|proyectos?|conduces?|rutas?|tareas?|veh[ií]culos?)|stock|existencias?|disponibles?|d[oó]nde hay|en qu[eé] (almac[eé]n(es)?|bodegas?|obras?|proyectos?)|inventario de|desempe[ñn]o|combustible|mantenimiento|actividad|qu[eé] hizo|qu[eé] hice|rutas? (de |del )?(hoy|d[ií]a)|s[aá]came|saca|saques|quiero|necesito|crea|cr[eé]ame|asigna|as[ií]gna|prepara|prep[aá]rame|mueve|env[ií]a|solicita|requisici[oó]n|conduce|taladro)\b/i;
const fuerzaHerramienta = (m) => INTENCION_DATOS.test(m);

check('router: "mira mi rol" fuerza herramienta', fuerzaHerramienta('mira mi rol en el sistema'));
check('router: "cuántos vehículos tenemos" fuerza herramienta', fuerzaHerramienta('¿cuántos vehículos tenemos?'));
check('router: "sácame 10 taladros del almacén central" fuerza herramienta', fuerzaHerramienta('sácame 10 taladros del almacén central'));
check('router: saludo "hola compa" NO fuerza herramienta', !fuerzaHerramienta('hola compa, buenas'));
// BE2 — las 3 preguntas literales de las capturas fuerzan herramienta.
check('router BE2: "que hizo hoy misael" fuerza herramienta', fuerzaHerramienta('Que hizo hoy misael'));
check('router BE2: "pasame un resumen de todas las rutas de hoy" fuerza herramienta', fuerzaHerramienta('Pasame un resumen de todas las rutas de hoy'));
check('router BE2: "en que almacenes o proyectos tengo disponible puntales" fuerza herramienta', fuerzaHerramienta('En que almacenes o proyectos tengo disponible puntales'));

// Validador de honestidad (BB4.4) — mismo patrón que index.ts `AFIRMA_VERIFICACION`.
const AFIRMA_VERIFICACION =
  /\b(acabo de (consultar|revisar|verificar|mirar|chequear)|consult[eé]|verifiqu[eé]|confirm[eé] con el sistema|en vivo|ya lo (revis[eé]|verifiqu[eé]|consult[eé])|reci[eé]n (consult|revis|verifi)|lo revis[eé] (ahora|en el sistema)|seg[uú]n (el sistema|la consulta que hice))\b/i;
const afirmaVerificacionSinTool = (t, huboTool) => !huboTool && AFIRMA_VERIFICACION.test(t);

check('validador: "acabo de consultarlo (esto sí es en vivo)" SIN tool → dispara',
  afirmaVerificacionSinTool('Tu rol es admin. Acabo de consultarlo (esto sí es en vivo).', false));
check('validador: mismo texto CON tool → NO dispara (fue consulta real)',
  !afirmaVerificacionSinTool('Tu rol es admin. Acabo de consultarlo.', true));
check('validador: respuesta honesta ("según tu perfil") NO dispara',
  !afirmaVerificacionSinTool('Según tu perfil eres administrador.', false));

// Idempotencia (BB3) — misma claveIdem que el edge.
function claveIdem(usuarioId, tipo, params) {
  const e = { tipo, u: usuarioId };
  if (tipo === 'conduce') { e.b = params.bodega_id; e.p = params.proyecto_id; e.i = (params.items ?? []).map((it) => `${it.articulo_id}:${it.cantidad}`).sort(); }
  else if (tipo === 'requisicion') { e.p = params.proyecto_id; e.i = (params.items ?? []).map((it) => `${it.articulo_id}:${it.cantidad}`).sort(); }
  else if (tipo === 'tarea') { e.p = params.proyecto_id; e.t = (params.titulo ?? '').trim().toLowerCase(); e.a = params.asignado_a ?? null; }
  else if (tipo === 'ruta') { e.c = params.conductor_usuario_id; e.v = params.vehiculo_id; e.cd = params.conduce_id ?? null; e.p = params.proyecto_id ?? null; }
  const s = JSON.stringify(e);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${tipo}_${h.toString(16)}`;
}
const conduceA = { bodega_id: 'B1', proyecto_id: 'P1', items: [{ articulo_id: 'A1', cantidad: 10 }] };
const conduceA2 = { bodega_id: 'B1', proyecto_id: 'P1', items: [{ articulo_id: 'A1', cantidad: 10 }] };
const conduceB = { bodega_id: 'B1', proyecto_id: 'P1', items: [{ articulo_id: 'A1', cantidad: 11 }] };
check('idempotencia: dos conduces idénticos → MISMA clave (un solo documento)',
  claveIdem('U1', 'conduce', conduceA) === claveIdem('U1', 'conduce', conduceA2));
check('idempotencia: distinta cantidad → distinta clave',
  claveIdem('U1', 'conduce', conduceA) !== claveIdem('U1', 'conduce', conduceB));
check('idempotencia: distinto usuario → distinta clave',
  claveIdem('U1', 'conduce', conduceA) !== claveIdem('U2', 'conduce', conduceA));

// Desambiguación (BB1) — la referencia de comportamiento esperado: con el calificativo
// "central", el mejor candidato es "Bodega Central", no "ALMACÉN las AMERICAS".
function mejorCandidato(qualifier, nombres) {
  const q = qualifier.toLowerCase();
  const score = (n) => (n.toLowerCase().includes(q) ? 1 : 0);
  const ranked = nombres.map((n) => ({ n, s: score(n) })).sort((a, b) => b.s - a.s);
  const hayEmpate = ranked.length > 1 && ranked[0].s === ranked[1].s;
  return { elegido: hayEmpate ? null : ranked[0].n, hayEmpate };
}
const r1 = mejorCandidato('central', ['ALMACÉN las AMERICAS', 'Bodega Central']);
check('desambiguación: "central" elige "Bodega Central" (no pregunta)', r1.elegido === 'Bodega Central' && !r1.hayEmpate);
// El caso correcto de PREGUNTAR (nombres que no coinciden con lo dicho): empate → null.
const r2 = mejorCandidato('xyz', ['Obra saasasa', 'Obra qqqqq']);
check('desambiguación: sin coincidencia real → empate → preguntar', r2.elegido === null && r2.hayEmpate);

// ─────────────────────────────────────────────────────────────────────────────
// (B) Guards de fuente — las técnicas del research siguen cableadas en el edge
// ─────────────────────────────────────────────────────────────────────────────
let src = '';
try { src = readFileSync(INDEX, 'utf8'); } catch { fails.push(`✗ no se pudo leer ${INDEX}`); }

check('fuente: tool_choice cableado (router BB4.2)', /tool_choice/.test(src) && /fuerzaHerramienta/.test(src));
check('fuente: validador post-respuesta presente (BB4.4)', /afirmaVerificacionSinTool/.test(src) && /validador_honestidad/.test(src));
check('fuente: tool `quien_soy` existe (identidad en vivo BB4.5)', /name:\s*"quien_soy"/.test(src));
check('fuente: identidad en bloque NO cacheado (BB4.5)', /bloqueIdentidad/.test(src) && /INSTRUCCIONES_ESTATICAS/.test(src));
check('fuente: fecha/hora RD en el prompt', /ahoraRD/.test(src));
check('fuente: schemas estrictos (additionalProperties:false)', /additionalProperties:\s*false/.test(src));
check('fuente: idempotencia de acciones (BB3)', /assistant_idempotencia/.test(src) && /claveIdem/.test(src));
check('fuente: transparencia es_prueba antes de confirmar (BB3)', /aviso_prueba/.test(src) && /es_prueba/.test(src));
check('fuente: tool `proponer_ruta` existe (BB3.d)', /name:\s*"proponer_ruta"/.test(src));
check('fuente: regla de desambiguación en el prompt (BB1)', /DESAMBIGUACI[OÓ]N/.test(src) && /Bodega Central/.test(src));

// BE2 — las 3 tools nuevas por rol + registro de no-atendidas + fin del error genérico.
check('fuente BE2: tool `actividad_de_usuario` existe', /name:\s*"actividad_de_usuario"/.test(src));
check('fuente BE2: tool `rutas_del_dia` existe', /name:\s*"rutas_del_dia"/.test(src));
check('fuente BE2: tool `disponibilidad_de_articulo` existe', /name:\s*"disponibilidad_de_articulo"/.test(src));
check('fuente BE2: tool `reportar_gap` existe (backlog sin_tool)', /name:\s*"reportar_gap"/.test(src));
check('fuente BE2: registro de consultas no atendidas cableado',
  /registrarNoAtendida/.test(src) && /registrar_consulta_no_atendida/.test(src));
check('fuente BE2: el error genérico "Intenta reformular" quedó PROHIBIDO (no aparece como respuesta)',
  !/respuestaFinal\s*=\s*"No pude completar la consulta\. Intenta reformular\."/.test(src));
check('fuente BE2: regla causa+salida en el prompt (nunca excusa vacía)',
  /CAUSA \+ SALIDA/.test(src));
check('fuente BE2: distingue sin_permiso vs error_de_tool para el backlog',
  /sin_permiso/.test(src) && /error_de_tool/.test(src));

// ─────────────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('\n🔴 EVALS DE COMPA — fallos:\n');
  console.error(fails.join('\n'));
  console.error(`\n(${ok.length} OK, ${fails.length} fallo(s))\n`);
  process.exit(1);
}
console.log(`\n✓ Evals de Compa OK (${ok.length} verificaciones: router, validador, idempotencia, desambiguación, identidad + guards de fuente).`);
