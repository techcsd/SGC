// BJ2 / BX3 — Extractor del PDF de factura de TotalEnergies (crédito fiscal electrónico).
// Reconstruye la tabla de consumo por POSICIÓN (getTextContent de pdfjs-dist) y
// produce el MISMO `InformeRow[]` que el parser de Excel/CSV — así el matcher y el
// import (confirmarImport/conciliar) NO se tocan.
//
// El PDF es texto (no escaneo). Estructura verificada contra los PDF reales de
// agosto (FA26/207554) y septiembre (FA26/220111, 3 páginas):
//   · Cabecera fiscal repetida por página (Número Factura, e-NCF, fechas, cliente).
//   · p.1 resumen por producto + Total Factura.
//   · p.2-3 detalle: transacciones AGRUPADAS por TARJETA. La identidad de la tarjeta
//     (código de 4 dígitos + titular + placa/XXXXXX) aparece en la línea de SUBTOTAL
//     («Consumo X L/100 Km») que sigue a sus transacciones (PIE de grupo, no cabecera).
//     El titular suele ser una PERSONA (ING. RAUL RUIZ…) o un vehículo (SUBURBAN
//     CHEVROLET 2023) partido en dos líneas — por eso el matcher necesita el mapeo
//     tarjeta→vehículo/persona (el código de 4 dígitos + la placa son las llaves).
//
// BX3 — El mapeo de columnas se hace **por la fila de encabezado de cada página**
// (`Fecha/Hora · Millaje · Número de recibo · Lugar · Producto · PU · Cantidad ·
//  Descuento · PU neto · Monto bruto · Base ITBIS · Impuesto ventas · Total facturado ·
//  Alerta`): se toma el x de cada título y la frontera entre columnas es el punto medio
// entre títulos contiguos. Así una plantilla con una columna de más/menos (julio) o un
// código en `Alerta` (X/Y…) NO corre las celdas. Antes se mapeaba por rangos fijos y
// una `Consumo -0.31` negativa dejaba una tarjeta sin detectar → sus echadas caían en
// la tarjeta siguiente y una quedaba inválida.

import type { InformeRow } from '../services/combustible-conciliacion.service';

/** Leyenda de la columna Alerta (pie de la última página). */
export const ALERTA_LEYENDA: Record<string, string> = {
  FR: 'Anulación de restricción de Frecuencia',
  H: 'Anulación de restricción de Horario de Uso',
  J: 'Anulación de restricción de Días de Uso',
  X: 'Anulación de restricción de Kilometraje',
  Y: 'Más de 1 Transacción en el día',
  Z: 'Anulación de restricción de Zona de Uso',
};

/** Texto corto para el chip de la vista previa. */
export const ALERTA_CHIP: Record<string, string> = {
  FR: 'Restricción de frecuencia anulada',
  H: 'Restricción de horario anulada',
  J: 'Restricción de días anulada',
  X: 'Restricción de kilometraje anulada',
  Y: 'Más de 1 transacción en el día',
  Z: 'Restricción de zona anulada',
};

export interface TotalEnergiesCard {
  codigo: string; // 4 dígitos, llave estable de la tarjeta
  titular: string;
  placa: string; // placa real o '' (XXXXXX/masked cuenta como vacío)
  es_persona: boolean;
  cantidad: number | null; // subtotal de galones del grupo
  monto: number | null; // subtotal facturado del grupo
}

export interface TotalEnergiesParse {
  rows: InformeRow[];
  header: {
    numero_factura: string;
    ncf: string;
    fecha_documento: string | null;
    fecha_vencimiento: string | null;
    total_factura: number | null;
    numero_cliente: string;
    numero_cuenta: string;
  };
  productos: { nombre: string; cantidad: number | null; monto: number | null }[];
  cards: TotalEnergiesCard[];
  // BV12 / BX3 — diagnóstico para la UI y el reporte automático a Tecnología:
  //  'ok' (hay transacciones) · 'sin_texto' (PDF escaneado, pdfjs no dio texto)
  //  · 'formato_desconocido' (hay texto pero la tabla no se reconoció)
  //  · 'columnas_faltantes' (se reconoció la tabla pero faltan columnas clave).
  diagnostico: 'ok' | 'sin_texto' | 'formato_desconocido' | 'columnas_faltantes';
  // BX3 — columnas del encabezado esperado que NO se encontraron en el PDF.
  columnas_faltantes: string[];
  // BX3 — cuadre: Σ Total de transacciones contra el total de la factura.
  cuadre: {
    esperado: number | null; // Total Productos y servicios consumidos / Total Factura
    obtenido: number; // Σ de `total` de las filas
    cuadra: boolean; // dentro de tolerancia (1.00)
    filas_invalidas: number;
  };
  // Primeras ~40 líneas de texto extraído, con montos redactados — para diagnosticar
  // un formato nuevo sin pedirle el archivo a Raykler (report_app_error).
  muestra: string[];
}

// ── Títulos del encabezado de la tabla de detalle → clave canónica ────────────
// El orden de este arreglo NO importa; el x real se lee del PDF.
const HEADER_TITLES: { key: ColKey; re: RegExp }[] = [
  { key: 'fecha', re: /^Fecha\/?Hora/i },
  { key: 'millaje', re: /^Millaje/i },
  { key: 'recibo', re: /^N[úu]mero$/i }, // "Número" (de recibo)
  { key: 'lugar', re: /^Lugar/i },
  { key: 'producto', re: /^Producto/i },
  { key: 'pu_neto', re: /^PU neto/i }, // antes que "PU"
  { key: 'pu', re: /^PU$/i },
  { key: 'cantidad', re: /^Cantidad/i },
  { key: 'descuento', re: /^Descuento/i },
  { key: 'monto_bruto', re: /^Monto/i },
  { key: 'base_itbis', re: /^Base/i },
  { key: 'impuesto', re: /^Impuesto/i },
  { key: 'total', re: /^Total$/i },
  { key: 'alerta', re: /^Alerta/i },
];

type ColKey =
  | 'fecha' | 'millaje' | 'recibo' | 'lugar' | 'producto' | 'pu' | 'cantidad'
  | 'descuento' | 'pu_neto' | 'monto_bruto' | 'base_itbis' | 'impuesto' | 'total' | 'alerta';

// Columnas imprescindibles para leer una echada; si el encabezado no las trae,
// el PDF es de un formato que no podemos importar con confianza.
const COLS_CLAVE: ColKey[] = ['fecha', 'cantidad', 'monto_bruto', 'total'];

/** Rangos [lo, hi) de cada columna, derivados del encabezado real de una página. */
type ColMap = Partial<Record<ColKey, [number, number]>>;

interface Cell { x: number; str: string; }
type CellsWithPage = Cell[] & { __page?: number };
interface Row { page: number; y: number; cells: Cell[]; text: string; }

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  let s = String(v).trim().replace(/rd\$?/i, '').replace(/[$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toIso(dmy: string | null | undefined): string | null {
  if (!dmy) return null;
  const m = String(dmy).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yy = y.length === 2 ? `20${y}` : y;
  return `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// BV12 — tolera dd/mm/yyyy (agosto) y dd-mm-yy / d-m-yyyy (otras plantillas de julio).
const DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
// BX3 — el consumo puede ser NEGATIVO ("-0.31 L/100 Km", tarjeta 0010 de septiembre):
// el `-?` es la corrección directa del bug que dejaba esa tarjeta sin detectar.
const CONSUMO_RE = /Consumo\s+-?[\d.,]+\s*L\s*\/\s*100/i;
const ALERTA_COD_RE = /^(FR|H|J|X|Y|Z)$/;
const HEADER_RE = /Fecha\/?Hora/i;
const SKIP_RE = /TotalEnergies Marketing|FACTURA DE CREDITO|Para contactarnos|Número cliente|Número cuenta|Los valores están|^Página|Fecha\/Hora|de recibo|incluyendo|impuestos|Producto\b.*Cantidad|Registro de Empresas|RNC:|TEL:|Email:|Website:|CONSTRUCTORA SCHEKER|VIRGILIO DIAZ|SANTO DOMINGO|Torre Acrópolis|Av\. Winston|Número Factura|e-NCF|Fecha de|Anulación de restricción|Más de 1 Transacción|Total Productos|Resumen impuestos|Total impuestos|Total Factura|Monto bruto|Producto blanco|CodigoSeguridad|FechaFirma|Modo de ajuste|datos bancarios|Banco Popular/i;

/** ¿La celda parece placa (real o enmascarada)? */
function looksLikePlate(s: string): boolean {
  return /^(PP-?\d{4,}|[A-Z]\d{5,}|\d{5,}[A-Z]?|X{4,})$/i.test(s.trim());
}
function esPlacaReal(s: string): boolean {
  return s !== '' && !/^x+$/i.test(s);
}
/** BX3/BV13 — normaliza placas para el auto-vínculo exacto: "PP295123" ↔ "PP-295123". */
export function normalizarPlaca(s: string): string {
  return (s || '').toUpperCase().replace(/[\s-]/g, '').trim();
}
function esPersona(titular: string, placaReal: boolean): boolean {
  if (/\bING\.?\b/i.test(titular)) return true;
  if (placaReal) return false;
  // Sin placa real y sin marca de vehículo conocida → probable persona.
  return !/(KIA|NISSAN|CHEVROLET|MITSUBISHI|SUBURBAN|IMPALA|FUSO|CAMION|FRONTIER|TOYOTA|HONDA|FORD|HYUNDAI|JEEP|SUZUKI|DOBLE CABINA|CONSTRUCTORA|APAGA FUEGO)/i.test(titular);
}

/** Celdas cuya x cae dentro del rango de la columna, unidas y saneadas. */
function pickCol(cells: Cell[], range: [number, number] | undefined): string {
  if (!range) return '';
  return cells
    .filter((c) => c.x >= range[0] && c.x < range[1])
    .sort((a, b) => a.x - b.x)
    .map((c) => c.str.trim())
    .join(' ')
    .trim();
}

/** Lee el encabezado de detalle de una página → rangos [lo,hi) por columna.
 *  Frontera entre columnas = punto medio entre los x de dos títulos contiguos. */
function anchorsFromHeader(headerCells: Cell[]): { cols: ColMap; faltantes: string[] } {
  const found: { key: ColKey; x: number }[] = [];
  const usados = new Set<ColKey>();
  for (const c of headerCells.slice().sort((a, b) => a.x - b.x)) {
    const s = c.str.trim();
    for (const t of HEADER_TITLES) {
      if (usados.has(t.key)) continue;
      if (t.re.test(s)) { found.push({ key: t.key, x: c.x }); usados.add(t.key); break; }
    }
  }
  found.sort((a, b) => a.x - b.x);
  const cols: ColMap = {};
  for (let i = 0; i < found.length; i++) {
    const lo = i === 0 ? -Infinity : (found[i - 1].x + found[i].x) / 2;
    const hi = i === found.length - 1 ? Infinity : (found[i].x + found[i + 1].x) / 2;
    cols[found[i].key] = [lo, hi];
  }
  const faltantes = HEADER_TITLES.filter((t) => !usados.has(t.key)).map((t) => t.key);
  return { cols, faltantes };
}

/** Configura el worker de pdfjs en el navegador (asset copiado por angular.json a la
 *  raíz del sitio; ver angular.json > assets). URL absoluta desde baseURI para que
 *  funcione con cualquier base href. En Node (test) no se toca (usa el fake worker). */
function configurarWorker(pdfjs: { GlobalWorkerOptions: { workerSrc: string } }) {
  const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (hasWindow && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
  }
}

export async function parseTotalEnergiesPdfFull(data: Uint8Array): Promise<TotalEnergiesParse> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  configurarWorker(pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } });
  const doc = await (pdfjs as { getDocument: (a: unknown) => { promise: Promise<PdfDoc> } })
    .getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;

  const allRows: Row[] = [];
  // BX3 — rangos de columna por página (el encabezado se repite y podría variar).
  const colsByPage = new Map<number, ColMap>();
  const faltantesGlobal = new Set<string>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map<number, Cell[]>();
    for (const it of tc.items as PdfItem[]) {
      const s = (it.str ?? '').trim();
      if (!s) continue;
      const x = Math.round(it.transform[4]);
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str: it.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a); // top→bottom
    for (const y of ys) {
      const cells = byY.get(y)!.sort((a, b) => a.x - b.x);
      const row: Row = { page: p, y, cells, text: cells.map((c) => c.str).join(' ') };
      allRows.push(row);
      // El encabezado de detalle: primera fila de la página que trae "Fecha/Hora".
      if (!colsByPage.has(p) && HEADER_RE.test(row.text) && cells.length >= 6) {
        const { cols, faltantes } = anchorsFromHeader(cells);
        colsByPage.set(p, cols);
        faltantes.forEach((f) => faltantesGlobal.add(f));
      }
    }
  }
  // Fallback: si alguna página de detalle no trajo encabezado propio, usa el de otra.
  const anyCols = [...colsByPage.values()][0];

  // ── Cabecera (de cualquier página, se repite) ───────────────────────────────
  const joined = allRows.map((r) => r.text).join('\n');
  const grab = (re: RegExp): string => (joined.match(re)?.[1] ?? '').trim();
  const header = {
    numero_factura: grab(/Número Factura:\s*([A-Z0-9/]+)/i),
    ncf: grab(/e-NCF:\s*([A-Z0-9]+)/i),
    fecha_documento: toIso(grab(/Fecha de documento:\s*([\d/]+)/i)),
    fecha_vencimiento: toIso(grab(/Fecha de vencimiento:\s*([\d/]+)/i)),
    total_factura: num(grab(/Total Factura[\s\S]*?DOP\s*([\d.,]+)/i)) ?? num(grab(/Total Factura\s+([\d.,]+)/i)),
    numero_cliente: grab(/Número cliente:\s*(\d+)/i),
    numero_cuenta: grab(/Número cuenta de cliente:\s*(\d+)/i),
  };
  // BX3 — "Total Productos y servicios consumidos" es el total contra el que se cuadra.
  const totalProductos = num(grab(/Total Productos y servicios consumidos\s+([\d.,]+)/i));

  // ── Resumen por producto (p.1) ──────────────────────────────────────────────
  const productos: TotalEnergiesParse['productos'] = [];
  for (const r of allRows) {
    // Filas del cuadro-resumen: "GASOLINA EXC 108.98 37,178.40 0.00 37,178.40"
    const m = r.text.match(/^((?:GASOLINA|DIESEL)[A-Z ]+?)\s+([\d.,]+)\s+([\d.,]+)\s+[\d.,]+\s+[\d.,]+$/i);
    if (m && r.cells.some((c) => c.x < 50)) {
      const nombre = m[1].trim().replace(/\s+/g, ' ');
      // Evitar duplicar por la repetición de página: solo el bloque de resumen.
      if (!productos.some((p) => p.nombre === nombre)) {
        productos.push({ nombre, cantidad: num(m[2]), monto: num(m[3]) });
      }
    }
  }

  // ── Detalle: transacciones agrupadas por tarjeta ────────────────────────────
  const rows: InformeRow[] = [];
  const cards: TotalEnergiesCard[] = [];
  let pending: CellsWithPage[] = []; // celdas por transacción pendiente de asignar a una tarjeta
  let cur: CellsWithPage | null = null;
  let pendingLugar: Cell[] = []; // BX3 — el Lugar suele venir en su propia línea, ANTES de la fecha
  let lastCardIdx = -1;

  const colsFor = (page: number): ColMap => colsByPage.get(page) ?? anyCols ?? {};

  const buildTx = (cells: Cell[], card: TotalEnergiesCard, idx: number, cols: ColMap): InformeRow => {
    // BX3 — fecha y hora se toman por REGEX (no por columna): son inequívocas y el
    // título "Fecha/Hora" comparte una sola columna de encabezado.
    const fechaCell = cells.find((c) => DATE_RE.test(c.str.trim()));
    const horaCell = cells.find((c) => TIME_RE.test(c.str.trim()));
    const fecha = toIso(fechaCell?.str);
    const hora = horaCell?.str.trim() ?? '';
    // Millaje: entero puro en su columna (excluye hora, que trae ":").
    const millajeCells = cols.millaje
      ? cells.filter((c) => c.x >= cols.millaje![0] && c.x < cols.millaje![1] && /^\d+$/.test(c.str.trim()))
      : [];
    const millaje = millajeCells.length ? num(millajeCells[0].str) : null;
    const recibo = pickCol(cells, cols.recibo).replace(/[^\d]/g, '');
    const lugar = pickCol(cells, cols.lugar).replace(/\s+/g, ' ');
    const producto = pickCol(cells, cols.producto).replace(/\s+/g, ' ');
    const cantidad = num(pickCol(cells, cols.cantidad));
    const montoBruto = num(pickCol(cells, cols.monto_bruto));
    const total = num(pickCol(cells, cols.total)) ?? montoBruto;
    // Alerta: código de una letra en su columna.
    const alertaCell = cols.alerta
      ? cells.find((c) => c.x >= cols.alerta![0] && c.x < cols.alerta![1] && ALERTA_COD_RE.test(c.str.trim()))
      : cells.find((c) => ALERTA_COD_RE.test(c.str.trim()) && c.x > 560);
    const alerta = alertaCell?.str.trim().toUpperCase() ?? '';
    // Llave de dedupe compuesta (el PDF no trae Transacción_num): factura#recibo#fecha#hora
    // + índice para blindar colisiones de recibo dentro del mismo minuto.
    const trans = `${header.numero_factura}#${recibo || 'NA'}#${fecha ?? 'NA'}#${hora || 'NA'}#${idx}`;
    const placaReal = esPlacaReal(card.placa);
    const identificador = placaReal ? card.placa : (card.titular || card.codigo);
    const motivos: string[] = [];
    const invalida = cantidad == null && total == null;
    if (invalida) motivos.push('No encontré Cantidad ni Total en esta fila — revisa las columnas del PDF');
    else if (cantidad == null) motivos.push('Sin galones (Cantidad) — se importa solo el monto');
    else if (total == null) motivos.push('Sin monto (Total) — se importa solo los galones');
    if (!producto) motivos.push('Producto vacío');
    return {
      identificador,
      fecha,
      galones: cantidad,
      monto: total,
      transaccion_num: trans,
      titular: card.titular,
      titular_es_persona: card.es_persona,
      numero_tarjeta: card.codigo,
      numero_registro: placaReal ? card.placa : '',
      producto,
      kilometraje: millaje,
      hora,
      estacion_codigo: '',
      estacion_ubicacion: lugar,
      ncf: header.ncf,
      trans_status: '',
      numero_factura: header.numero_factura,
      total_factura: header.total_factura,
      fecha_factura: header.fecha_documento,
      alerta: alerta || undefined,
      motivos: motivos.length ? motivos : undefined,
      invalida,
    };
  };

  const flush = (card: TotalEnergiesCard) => {
    const txs: CellsWithPage[] = cur ? [...pending, cur] : [...pending];
    txs.forEach((cells, i) => {
      rows.push(buildTx(cells, card, rows.length + i, colsFor(cells.__page ?? 1)));
    });
    pending = [];
    cur = null;
  };

  for (const r of allRows) {
    // BX3 — solo las páginas con encabezado de detalle traen transacciones. Así el
    // resumen fiscal de la p.1 (productos, "Total Factura", "Ciento Diecinueve Mil…")
    // NO se cuela en la primera transacción.
    if (!colsByPage.has(r.page)) continue;
    // Anota la página en el arreglo de celdas para elegir el ColMap correcto al construir.
    (r.cells as CellsWithPage).__page = r.page;

    // BX3 — el pie de tarjeta ("Consumo … L/100 Km") cierra el grupo: asigna a esa
    // tarjeta TODAS las transacciones acumuladas. Se detecta ANTES que fecha/skip.
    if (CONSUMO_RE.test(r.text)) {
      const cols = colsFor(r.page);
      const codigo = (r.cells.find((c) => c.x < 70 && /^\d{3,4}$/.test(c.str.trim()))?.str ?? '').trim();
      // Nombre + placa: celdas entre el código y la palabra "Consumo".
      const consumoX = r.cells.find((c) => /^Consumo/i.test(c.str.trim()))?.x ?? 213;
      const nameCells = r.cells.filter((c) => c.x >= 70 && c.x < consumoX);
      let placa = '';
      const nombreParts: string[] = [];
      for (const c of nameCells) {
        const t = c.str.trim();
        if (looksLikePlate(t)) { placa = t; continue; }
        // Descarta el millaje/kilometraje suelto (1-3 dígitos); conserva años (2022…).
        if (/^\d{1,3}$/.test(t)) continue;
        nombreParts.push(t);
      }
      const titular = nombreParts.join(' ').replace(/\s+/g, ' ').trim();
      const card: TotalEnergiesCard = {
        codigo,
        titular,
        placa: esPlacaReal(placa) ? placa : '',
        es_persona: esPersona(titular, esPlacaReal(placa)),
        cantidad: num(pickCol(r.cells, cols.cantidad)),
        monto: num(pickCol(r.cells, cols.total)) ?? num(pickCol(r.cells, cols.monto_bruto)),
      };
      flush(card);
      cards.push(card);
      lastCardIdx = cards.length - 1;
      pendingLugar = [];
      continue;
    }

    const cols = colsFor(r.page);
    const inFecha = (c: Cell) => !cols.fecha || (c.x >= cols.fecha[0] && c.x < cols.fecha[1]);
    const hasDate = r.cells.some((c) => inFecha(c) && DATE_RE.test(c.str.trim()));

    if (hasDate) {
      // Inicio de transacción. Adjunta el Lugar buffered (si venía en su propia línea).
      if (cur) pending.push(cur);
      cur = [...pendingLugar, ...r.cells];
      (cur as CellsWithPage).__page = r.page;
      pendingLugar = [];
      continue;
    }

    // BV12 — SKIP_RE nunca se traga una fila con fecha (ya cubierto arriba).
    if (SKIP_RE.test(r.text)) continue;

    // Una línea "TotalEnergies <estación>" mientras hay una transacción abierta es el
    // Lugar de la SIGUIENTE transacción (viene antes de su fecha): cierra la actual y
    // guárdalo para adjuntarlo, no lo mezcles con la echada en curso.
    const esLugarSuelto = /^TotalEnergies\b/i.test(r.text.trim());
    if (cur && esLugarSuelto) {
      pending.push(cur);
      cur = null;
      pendingLugar = [...r.cells];
      continue;
    }
    // Continuación: de la transacción en curso, o (entre tarjeta y tarjeta) del nombre
    // de la última tarjeta / del Lugar de la próxima transacción.
    if (cur) {
      cur.push(...r.cells);
    } else if (lastCardIdx >= 0 && r.cells.every((c) => c.x >= 60 && c.x < 150)) {
      // Nombre de tarjeta que sigue en la(s) línea(s) de abajo (p.ej. "CHEVROLET 2023",
      // "PERALTA", "2022", "GENERAL").
      const extra = r.cells.map((c) => c.str.trim()).join(' ').trim();
      if (extra) {
        const cardRef = cards[lastCardIdx];
        cardRef.titular = `${cardRef.titular} ${extra}`.replace(/\s+/g, ' ').trim();
        cardRef.es_persona = esPersona(cardRef.titular, esPlacaReal(cardRef.placa));
        // Re-etiqueta las filas ya emitidas de esa tarjeta con el titular completo.
        for (const row of rows) {
          if (row.numero_tarjeta === cardRef.codigo) {
            row.titular = cardRef.titular;
            row.titular_es_persona = cardRef.es_persona;
            if (!esPlacaReal(cardRef.placa)) row.identificador = cardRef.titular || cardRef.codigo;
          }
        }
      }
    } else if (/^TotalEnergies\b/i.test(r.text.trim())) {
      // Lugar de la próxima transacción, en su propia línea ANTES de la fecha
      // ("TotalEnergies TIRADENTES"): se guarda para adjuntarlo. Cualquier otra línea
      // suelta (pies "DOP …", "Ciento Diecinueve Mil…") se ignora.
      pendingLugar.push(...r.cells);
    }
  }
  // Transacciones sin tarjeta (no debería ocurrir): se emiten con su propio identificador.
  if (pending.length || cur) {
    const orphan: TotalEnergiesCard = { codigo: '', titular: '', placa: '', es_persona: false, cantidad: null, monto: null };
    flush(orphan);
  }

  // BX3 — cuadre: Σ Total de transacciones vs "Total Productos y servicios consumidos".
  const sumaTotal = rows.reduce((s, r) => s + (r.monto ?? 0), 0);
  const esperado = totalProductos ?? header.total_factura;
  const filasInvalidas = rows.filter((r) => r.invalida).length;
  const cuadre = {
    esperado,
    obtenido: Number(sumaTotal.toFixed(2)),
    cuadra: esperado == null ? false : Math.abs(sumaTotal - esperado) <= 1,
    filas_invalidas: filasInvalidas,
  };

  // BV12 / BX3 — diagnóstico + muestra (montos redactados) para UI y reporte automático.
  const redact = (t: string) => t.replace(/\d[\d,]*\.\d{2}\b/g, '***');
  const muestra = allRows.slice(0, 40).map((r) => redact(r.text));
  const columnas_faltantes = [...faltantesGlobal];
  const faltanClave = COLS_CLAVE.filter((c) => faltantesGlobal.has(c));
  const diagnostico: TotalEnergiesParse['diagnostico'] =
    allRows.length === 0 ? 'sin_texto'
      : rows.length === 0 ? (faltanClave.length ? 'columnas_faltantes' : 'formato_desconocido')
        : 'ok';

  return { rows, header, productos, cards, diagnostico, columnas_faltantes, cuadre, muestra };
}

// Tipos mínimos de pdfjs (evita depender de sus .d.ts en el build).
interface PdfItem { str: string; transform: number[]; }
interface PdfPage { getTextContent(): Promise<{ items: unknown[] }>; }
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; }
