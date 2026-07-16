// Utilidad compartida de exportación a Excel (xlsx ya es dependencia del repo).
// Import dinámico para no engordar el bundle inicial (mismo patrón que bitácora).
//
// Uso simple:  await exportarExcel('conduces', filas)
// Multi-hoja:  await exportarExcelHojas('bitacora-123', [{ nombre:'Resumen', filas }, ...])

export interface HojaExcel {
  nombre: string;
  filas: Record<string, unknown>[];
}

/** Nombre de archivo seguro + fecha local (YYYY-MM-DD) para el sufijo. */
function nombreArchivo(base: string): string {
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const safe = base.replace(/[^0-9A-Za-zÁÉÍÓÚáéíóúÑñ._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${safe || 'export'}-${fecha}.xlsx`;
}

/** Exporta una sola tabla (array de objetos planos) a un .xlsx de una hoja. */
export async function exportarExcel(
  base: string,
  filas: Record<string, unknown>[],
  hoja = 'Datos',
): Promise<void> {
  await exportarExcelHojas(base, [{ nombre: hoja, filas }]);
}

/** Exporta varias hojas a un mismo libro .xlsx. Hojas vacías se omiten. */
export async function exportarExcelHojas(base: string, hojas: HojaExcel[]): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  let agregadas = 0;
  for (const h of hojas) {
    if (!h.filas?.length) continue;
    const ws = XLSX.utils.json_to_sheet(h.filas);
    // Ancho de columnas razonable a partir del contenido.
    const cols = Object.keys(h.filas[0] ?? {});
    ws['!cols'] = cols.map((c) => {
      const max = Math.max(c.length, ...h.filas.map((r) => String(r[c] ?? '').length));
      return { wch: Math.min(Math.max(max + 2, 8), 60) };
    });
    // Nombre de hoja válido para Excel (máx 31 chars, sin caracteres prohibidos).
    const safeName = (h.nombre || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
    agregadas++;
  }
  if (agregadas === 0) {
    // Libro con una hoja vacía para no fallar cuando no hay datos.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sin datos']]), 'Datos');
  }
  XLSX.writeFile(wb, nombreArchivo(base));
}
