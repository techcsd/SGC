// G1 — zona protegida: el agente NO puede tocar su propia guardia, secrets ni la protección de ramas.
import { coincideAlguno, normalizarRuta } from './glob.mjs';

export const ZONA_PROTEGIDA = [
  '.github/workflows/agente-*.yml',
  '.github/workflows/agente-*.yaml',
  'scripts/guardianes/**',
  '.claude/**',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'sql/_reversa/**',
  '.github/branch-protection-*.json',
];

// cambios: [{ ruta, estado }] -> motivos[] (vacío = OK). Borrar o renombrar también cuenta.
export function revisarZonaProtegida(cambios, zona = ZONA_PROTEGIDA) {
  const motivos = [];
  for (const c of cambios) {
    const rutas = [c.ruta, c.rutaAnterior].filter(Boolean).map(normalizarRuta);
    for (const r of rutas) {
      if (coincideAlguno(r, zona)) {
        motivos.push({ codigo: 'zona_protegida', ruta: r, detalle: `El PR toca la zona protegida (${r}). El agente no puede modificar su guardia, instrucciones ni la protección de ramas.` });
      }
    }
  }
  return motivos;
}
