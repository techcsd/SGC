// BV12 — regresión del parser de facturas TotalEnergies. Usa los PDF reales de
// `qa/pdf/` (gitignored); si no están (CI), el test se SALTA (no rompe el pipeline).
// Agosto (FA26_207554) = 20 transacciones, 61,887.06. Cuando exista el fixture de
// julio, añade su conteo aquí.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTotalEnergiesPdfFull } from '../../src/shared/utils/parse-pdf-totalenergies.util';

const dir = join(process.cwd(), 'qa', 'pdf');
const agosto = join(dir, 'FA26_207554_agosto.pdf');

describe('parse-pdf-totalenergies (BV12)', () => {
  it.skipIf(!existsSync(agosto))('agosto: 20 transacciones, diagnostico ok', async () => {
    const parsed = await parseTotalEnergiesPdfFull(new Uint8Array(readFileSync(agosto)));
    expect(parsed.diagnostico).toBe('ok');
    expect(parsed.rows.length).toBe(20);
    // Suma de galones/monto coherente con el resumen de la factura (61,887.06).
    const monto = parsed.rows.reduce((s, r) => s + (r.monto ?? 0), 0);
    expect(Math.round(monto)).toBe(61887);
  });
});
