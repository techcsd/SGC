// verify-boveda-fuera-de-ia.mjs — DZ-15 (CZ3) + DA-17 (ronda DA). El Vault y la
// clave cifrada del equipo NUNCA deben quedar alcanzables desde Compa/el
// conector MCP/el asistente: falla el build si `boveda`/`boveda_`, o
// `equipos-clave`/`equipos_clave`/`tec_equipo_claves`, aparecen en los archivos
// que definen las herramientas de IA, la edge del asistente o el conector MCP.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const OBJETIVOS = [
  join(ROOT, 'supabase', 'functions', '_shared', 'herramientas.ts'),
  join(ROOT, 'supabase', 'functions', 'assistant'),
  join(ROOT, 'supabase', 'functions', 'mcp'),
];

function fail(msg) {
  console.error(`\x1b[31m✗ verify-boveda-fuera-de-ia: ${msg}\x1b[0m`);
  process.exit(1);
}

function walkFiles(path, out) {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) walkFiles(join(path, name), out);
  } else if (/\.(ts|tsx)$/.test(path)) {
    out.push(path);
  }
}

const archivos = [];
for (const objetivo of OBJETIVOS) walkFiles(objetivo, archivos);

const RE = /\bboveda(_\w+)?\b/i;
const RE_CLAVES_EQUIPO = /\bequipos[-_]clave\b|\btec_equipo_claves\b/i;
let hallazgos = 0;
for (const f of archivos) {
  const txt = readFileSync(f, 'utf8');
  const lineas = txt.split('\n');
  lineas.forEach((linea, i) => {
    if (RE.test(linea) || RE_CLAVES_EQUIPO.test(linea)) {
      hallazgos++;
      console.error(`  ${f}:${i + 1}: ${linea.trim()}`);
    }
  });
}

if (hallazgos) {
  fail(`${hallazgos} referencia(s) a 'boveda'/clave-de-equipo en código de IA — el Vault y la clave del equipo NUNCA entran a Compa/MCP/assistant (DZ-15/DA-17).`);
}

console.log(`\x1b[32m✓ verify-boveda-fuera-de-ia:\x1b[0m sin referencias al Vault ni a claves de equipo en ${archivos.length} archivo(s) de IA/conector.`);
process.exit(0);
