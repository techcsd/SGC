// CQ4-g — candado de regresión: si el formulario REAL de vehículos/choferes gana un
// campo, la plantilla de importación (ENTIDADES en importador.service.ts) debe
// enterarse — o quedar EXCLUIDO aquí explícitamente, con motivo. Lee los .html reales
// con `readFileSync` (más fiable que una lista hardcodeada que se desactualiza sola).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ENTIDADES, EntidadImportable } from './importador.service';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/shared/services → src/
const SRC = join(__dirname, '..', '..');

function formControlNames(relPathFromSrc: string): string[] {
  const html = readFileSync(join(SRC, relPathFromSrc), 'utf8');
  const out = new Set<string>();
  for (const m of html.matchAll(/formControlName="([^"]+)"/g)) out.add(m[1]);
  return [...out];
}

function camposPlantilla(key: string): string[] {
  const e = ENTIDADES.find((x) => x.key === key) as EntidadImportable;
  return e.campos.map((c) => c.t);
}

// Controles de UI que mapean a UN SOLO campo final de la plantilla (p. ej. un
// select + input "Otro…" que terminan escribiendo la misma columna `color`).
const EXCLUSIONES: Record<string, string[]> = {
  vehiculos: ['colorSel', 'colorOtro', 'aseguradoraSel', 'aseguradoraOtro'],
  conductores: [],
};

// Controles que el formulario maneja como signal/chip-input (NO `formControlName`,
// así que el regex no los ve) pero que SÍ deben estar en la plantilla.
const EXTRA_NO_FORM_CONTROL: Record<string, string[]> = {
  vehiculos: [],
  conductores: ['tags'], // chip-input basado en signals (conductores.ts ~L113-497), no reactive form control.
};

describe('Importador — candado de campos del formulario real (CQ4-g)', () => {
  it('vehiculos.html: todo formControlName (salvo exclusión documentada) existe en la plantilla de importación', () => {
    const controles = [
      ...formControlNames('app/pages/flota/vehiculos/vehiculos.html'),
      ...EXTRA_NO_FORM_CONTROL['vehiculos'],
    ];
    const plantilla = camposPlantilla('vehiculos');
    const faltan = controles.filter((c) => !EXCLUSIONES['vehiculos'].includes(c) && !plantilla.includes(c));
    expect(faltan, `Faltan en la plantilla de vehículos: ${faltan.join(', ')} — agrégalos a ENTIDADES.vehiculos.campos o a EXCLUSIONES con motivo.`).toEqual([]);
  });

  it('conductores.html: todo formControlName (+ tags) existe en la plantilla de importación', () => {
    const controles = [
      ...formControlNames('app/pages/flota/conductores/conductores.html'),
      ...EXTRA_NO_FORM_CONTROL['conductores'],
    ];
    const plantilla = camposPlantilla('conductores');
    const faltan = controles.filter((c) => !EXCLUSIONES['conductores'].includes(c) && !plantilla.includes(c));
    expect(faltan, `Faltan en la plantilla de choferes: ${faltan.join(', ')} — agrégalos a ENTIDADES.conductores.campos o a EXCLUSIONES con motivo.`).toEqual([]);
  });
});
