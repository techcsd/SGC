// scripts/cobertura-conector.mjs — CS5 — que no vuelva a quedar un módulo del
// SGC sin herramienta del conector de Claude Y SIN que se note. Compara los
// módulos reales (MODULOS_DISPONIBLES de roles.service.ts) + las pantallas
// "siempre visibles" (sin gate de módulo) contra `modulos` en
// `_shared/herramientas.ts`. Falla si un módulo no tiene NINGUNA herramienta
// propia y tampoco una exención documentada con motivo en docs/CLAUDE-CONECTOR.md.
//
//   node scripts/cobertura-conector.mjs [--report]
//
// Estático (no toca la BD) → corre en prebuild y en release-check.
import { readFileSync } from 'node:fs';

const REPORT_ONLY = process.argv.includes('--report');

// ── 1. Módulos reales (clave → label) desde MODULOS_DISPONIBLES (acotado a ESE
// array — roles.service.ts tiene otros `{key,label}` que no son módulos). ────
const rolesSrc = readFileSync('src/shared/services/roles.service.ts', 'utf8');
const inicioArray = rolesSrc.indexOf('export const MODULOS_DISPONIBLES');
if (inicioArray === -1) {
  console.error('🔴 cobertura-conector: no encontré MODULOS_DISPONIBLES en roles.service.ts (¿cambió el nombre?).');
  process.exit(1);
}
const finArray = rolesSrc.indexOf('\n];', inicioArray);
const bloqueModulos = rolesSrc.slice(inicioArray, finArray === -1 ? undefined : finArray);
const modulosReales = [];
for (const m of bloqueModulos.matchAll(/\{\s*key:\s*'([a-z_]+)',\s*label:\s*'([^']+)'/g)) {
  modulosReales.push({ key: m[1], label: m[2] });
}
if (!modulosReales.length) {
  console.error('🔴 cobertura-conector: no pude leer ningún módulo de MODULOS_DISPONIBLES (¿cambió el formato?).');
  process.exit(1);
}

// ── 2. Pantallas "siempre visibles" (sin gate de módulo) — mantenido a mano:
// cada una que el SGC trate como "todo usuario autenticado" debe aparecer aquí
// Y tener alguna herramienta con modulos:null que la cubra (o una exención). ──
const SIEMPRE_VISIBLES = [
  { key: 'notas', label: 'Dev notes / Notas' },
  { key: 'mensajes', label: 'Mensajería' },
  { key: 'soporte', label: 'Soporte / reportes de error' },
  { key: 'requisiciones', label: 'Requisiciones (bandeja propia)' },
  { key: 'dudas', label: 'Dudas / ayuda' },
];

const TODOS_LOS_MODULOS = [...modulosReales, ...SIEMPRE_VISIBLES];

// ── 3. Qué módulos cubre hoy el registro de herramientas ─────────────────────
const toolsSrc = readFileSync('supabase/functions/_shared/herramientas.ts', 'utf8');
const modulosCubiertos = new Set();
// Un tool con modulos:null cubre TODAS las "siempre visibles" (son del mismo
// contrato: sin gate). Un tool con modulos:[...] cubre esos módulos reales.
let hayToolSinGate = false;
for (const m of toolsSrc.matchAll(/modulos:\s*(null|\[[^\]]*\])/g)) {
  if (m[1] === 'null') { hayToolSinGate = true; continue; }
  for (const claveM of m[1].matchAll(/"([a-z_]+)"/g)) modulosCubiertos.add(claveM[1]);
}
if (hayToolSinGate) for (const s of SIEMPRE_VISIBLES) modulosCubiertos.add(s.key);

// ── 4. Exenciones documentadas (docs/CLAUDE-CONECTOR.md, tabla "Exenciones") ─
const docsSrc = readFileSync('docs/CLAUDE-CONECTOR.md', 'utf8');
const exenciones = new Set();
const seccionExencion = docsSrc.split('**Exenciones documentadas**')[1]?.split(/\n## /)[0] ?? '';
// Busca las claves de módulo citadas entre backticks en esa sección.
for (const { key } of TODOS_LOS_MODULOS) {
  if (seccionExencion.includes(`\`${key}\``)) exenciones.add(key);
}

// ── 5. Veredicto ──────────────────────────────────────────────────────────
const sinCubrir = TODOS_LOS_MODULOS.filter((m) => !modulosCubiertos.has(m.key) && !exenciones.has(m.key));

if (REPORT_ONLY) {
  console.log('Módulo'.padEnd(16), 'Cubierto', 'Exento');
  for (const m of TODOS_LOS_MODULOS) {
    console.log(m.key.padEnd(16), modulosCubiertos.has(m.key) ? '✓' : '·', exenciones.has(m.key) ? '✓' : '·');
  }
  process.exit(0);
}

if (sinCubrir.length) {
  console.error(`\n🔴 cobertura-conector: ${sinCubrir.length} módulo(s) SIN herramienta y SIN exención documentada:\n`);
  for (const m of sinCubrir) console.error(`   · ${m.key} (${m.label})`);
  console.error('\nAgrega una herramienta con ese módulo en modulos:[...] (o modulos:null si no debe tener gate),');
  console.error('o documenta por qué no la tiene en la tabla "Exenciones documentadas" de docs/CLAUDE-CONECTOR.md (§11, CS5).\n');
  process.exit(1);
}

console.log(`✓ cobertura-conector: ${TODOS_LOS_MODULOS.length} módulo(s)/pantalla(s) revisados — todos con herramienta o exención documentada.`);
