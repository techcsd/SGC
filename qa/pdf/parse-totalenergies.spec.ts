// BV12 / BX3 — regresión del parser de facturas TotalEnergies. Usa los PDF reales de
// `qa/pdf/` (gitignored); si no están (CI), el test se SALTA (no rompe el pipeline).
//   · Agosto (FA26_207554) = 20 transacciones, 61,887.06.
//   · Septiembre (FA26_220111) = 32 transacciones, 15 tarjetas, 119,332.52, 2 alertas X,
//     tarjeta 0010 = SUBURBAN CHEVROLET 2023 / PP295123 con 2 tx (11.50 + 15.57 gal).
//   · Julio (FA26_203060) — cuando Raykler lo consiga, ver el `it.skipIf` del final.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTotalEnergiesPdfFull } from '../../src/shared/utils/parse-pdf-totalenergies.util';

const dir = join(process.cwd(), 'qa', 'pdf');
const agosto = join(dir, 'FA26_207554_agosto.pdf');
const septiembre = join(dir, 'FA26_220111.pdf');
const julio = join(dir, 'FA26_203060.pdf');

describe('parse-pdf-totalenergies (BV12/BX3)', () => {
  it.skipIf(!existsSync(agosto))('agosto: 20 transacciones, diagnostico ok', async () => {
    const parsed = await parseTotalEnergiesPdfFull(new Uint8Array(readFileSync(agosto)));
    expect(parsed.diagnostico).toBe('ok');
    expect(parsed.rows.length).toBe(20);
    // Suma de galones/monto coherente con el resumen de la factura (61,887.06).
    const monto = parsed.rows.reduce((s, r) => s + (r.monto ?? 0), 0);
    expect(Math.round(monto)).toBe(61887);
    expect(parsed.rows.some((r) => r.invalida)).toBe(false);
  });

  it.skipIf(!existsSync(septiembre))('septiembre: 32 tx, 15 tarjetas, 119,332.52, cuadra, 2 alertas X', async () => {
    const p = await parseTotalEnergiesPdfFull(new Uint8Array(readFileSync(septiembre)));
    expect(p.diagnostico).toBe('ok');
    expect(p.rows.length).toBe(32);
    expect(p.cards.length).toBe(15);
    expect(p.rows.some((r) => r.invalida)).toBe(false);
    // Cuadre exacto contra "Total Productos y servicios consumidos".
    expect(p.cuadre.esperado).toBe(119332.52);
    expect(p.cuadre.obtenido).toBe(119332.52);
    expect(p.cuadre.cuadra).toBe(true);
    // Dos transacciones con alerta X (restricción de kilometraje anulada).
    const conX = p.rows.filter((r) => r.alerta === 'X');
    expect(conX.length).toBe(2);
    // Tarjeta 0010 = SUBURBAN CHEVROLET 2023 / PP295123, con 2 transacciones.
    const c10 = p.cards.find((c) => c.codigo === '0010');
    expect(c10?.titular).toBe('SUBURBAN CHEVROLET 2023');
    expect(c10?.placa).toBe('PP295123');
    const t10 = p.rows.filter((r) => r.numero_tarjeta === '0010');
    expect(t10.length).toBe(2);
    expect(t10.map((r) => r.galones).sort()).toEqual([11.5, 15.57]);
    // La echada del Suburban 21/09 16:29 (la que salía inválida) ahora es válida con su X.
    const suburbanX = t10.find((r) => r.alerta === 'X');
    expect(suburbanX?.galones).toBe(15.57);
    expect(suburbanX?.monto).toBe(5450.71);
    // Cuatro placas PP detectadas.
    expect(p.cards.filter((c) => /^PP/.test(c.placa)).length).toBe(4);
  });

  // Cuando Raykler suba/entregue el reporte de julio (BX4 lo guardará aunque falle),
  // añade aquí su conteo esperado. Por ahora se salta con aviso.
  it.skipIf(!existsSync(julio))('julio: se lee sin filas inválidas', async () => {
    const p = await parseTotalEnergiesPdfFull(new Uint8Array(readFileSync(julio)));
    expect(p.diagnostico).toBe('ok');
    expect(p.rows.length).toBeGreaterThan(0);
    expect(p.rows.some((r) => r.invalida)).toBe(false);
  });
});
