// BJ2 — Extractor del PDF de factura de TotalEnergies (crédito fiscal electrónico).
// Reconstruye la tabla de consumo por POSICIÓN (getTextContent de pdfjs-dist) y
// produce el MISMO `InformeRow[]` que el parser de Excel/CSV — así el matcher y el
// import (confirmarImport/conciliar) NO se tocan.
//
// El PDF es texto (no escaneo). Estructura verificada contra
// `referencia-factura-totalenergies-BJ2.pdf` (FA26/215223, 3 páginas):
//   · Cabecera fiscal repetida por página (Número Factura, e-NCF, fechas, cliente).
//   · p.1 resumen por producto + Total Factura.
//   · p.2-3 detalle: transacciones AGRUPADAS por TARJETA. La identidad de la tarjeta
//     (código de 4 dígitos + titular + placa/XXXXXX) aparece en la línea de SUBTOTAL
//     («Consumo X L/100 Km») que sigue a sus transacciones. El titular suele ser una
//     PERSONA (ING. RAUL RUIZ…), no una placa — por eso el matcher necesita el mapeo
//     tarjeta→vehículo/persona (el código de 4 dígitos es la llave estable).
//
// Cada fila de transacción se aplana por rangos de X (columnas del encabezado).

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
}

// ── Rangos de columna por X (según el encabezado de la tabla de detalle) ──────
const COL = {
  fecha: [20, 70],
  hora: [70, 98],
  millaje: [98, 127],
  recibo: [127, 155],
  lugar: [155, 222],
  producto: [222, 270],
  pu: [270, 300],
  cantidad: [300, 335],
  monto: [412, 451],
  total: [512, 566],
  alerta: [566, 999],
} as const;

interface Cell { x: number; str: string; }
interface Row { page: number; y: number; cells: Cell[]; text: string; }

function num(v: string | null | undefined): number | null {
  if (!v) return null;
  let s = String(v).trim().replace(/rd\$?/i, '').replace(/[$\s]/g, '');
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

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const CONSUMO_RE = /Consumo\s+[\d.,]+\s*L\/100/i;
const SKIP_RE = /TotalEnergies Marketing|FACTURA DE CREDITO|Para contactarnos|Número cliente|Número cuenta|Los valores están|^Página|Fecha\/Hora|de recibo|incluyendo|impuestos|Producto\b.*Cantidad|Registro de Empresas|RNC:|TEL:|Email:|Website:|CONSTRUCTORA SCHEKER|VIRGILIO DIAZ|SANTO DOMINGO|Torre Acrópolis|Av\. Winston|Número Factura|e-NCF|Fecha de|Anulación de restricción|Más de 1 Transacción/i;

/** ¿La celda parece placa (real o enmascarada)? */
function looksLikePlate(s: string): boolean {
  return /^(PP\d{4,}|[A-Z]\d{5,}|\d{5,}[A-Z]?|X{4,})$/i.test(s.trim());
}
function esPlacaReal(s: string): boolean {
  return s !== '' && !/^x+$/i.test(s);
}
function esPersona(titular: string, placaReal: boolean): boolean {
  if (/\bING\.?\b/i.test(titular)) return true;
  if (placaReal) return false;
  // Sin placa real y sin marca de vehículo conocida → probable persona.
  return !/(KIA|NISSAN|CHEVROLET|MITSUBISHI|SUBURBAN|IMPALA|FUSO|CAMION|FRONTIER|TOYOTA|HONDA|FORD|HYUNDAI|JEEP|SUZUKI|DOBLE CABINA|CONSTRUCTORA|APAGA FUEGO)/i.test(titular);
}

function pick(cells: Cell[], range: readonly [number, number] | number[]): string {
  return cells
    .filter((c) => c.x >= range[0] && c.x < range[1])
    .sort((a, b) => a.x - b.x)
    .map((c) => c.str.trim())
    .join(' ')
    .trim();
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
      allRows.push({ page: p, y, cells, text: cells.map((c) => c.str).join(' ') });
    }
  }

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

  // ── Resumen por producto (p.1) ──────────────────────────────────────────────
  const productos: TotalEnergiesParse['productos'] = [];
  for (const r of allRows) {
    // Filas del cuadro-resumen: "GASOLINA EXC 108.98 37,178.40 0.00 37,178.40"
    const m = r.text.match(/^((?:GASOLINA|DIESEL)[A-Z ]+?)\s+([\d.,]+)\s+([\d.,]+)\s+[\d.,]+\s+[\d.,]+$/i);
    if (m && r.cells.some((c) => c.x < 50)) {
      const nombre = m[1].trim().replace(/\s+/g, ' ');
      // Evitar duplicar por la repetición de página: solo el bloque de resumen (x~276 cantidad).
      if (!productos.some((p) => p.nombre === nombre)) {
        productos.push({ nombre, cantidad: num(m[2]), monto: num(m[3]) });
      }
    }
  }

  // ── Detalle: transacciones agrupadas por tarjeta ────────────────────────────
  const rows: InformeRow[] = [];
  const cards: TotalEnergiesCard[] = [];
  let pending: Cell[][] = []; // celdas por transacción pendiente de asignar a una tarjeta
  let cur: Cell[] | null = null;
  let lastCardIdx = -1;

  const buildTx = (cells: Cell[], card: TotalEnergiesCard, idx: number): InformeRow => {
    const fecha = toIso(pick(cells, COL.fecha).match(DATE_RE) ? pick(cells, COL.fecha) : (cells.find((c) => DATE_RE.test(c.str.trim()))?.str ?? ''));
    const hora = pick(cells, COL.hora);
    const millaje = num(pick(cells, COL.millaje));
    const recibo = pick(cells, COL.recibo);
    const lugar = pick(cells, COL.lugar);
    const producto = pick(cells, COL.producto).replace(/\s+/g, ' ');
    const cantidad = num(pick(cells, COL.cantidad));
    const total = num(pick(cells, COL.total)) ?? num(pick(cells, COL.monto));
    const alerta = pick(cells, COL.alerta);
    // Llave de dedupe compuesta (el PDF no trae Transacción_num): factura#recibo#fecha#hora
    // + índice para blindar colisiones de recibo dentro del mismo minuto.
    const trans = `${header.numero_factura}#${recibo || 'NA'}#${fecha ?? 'NA'}#${hora || 'NA'}#${idx}`;
    const placaReal = esPlacaReal(card.placa);
    const identificador = placaReal ? card.placa : (card.titular || card.codigo);
    const motivos: string[] = [];
    if (cantidad == null && total == null) motivos.push('sin galones ni monto');
    if (!producto) motivos.push('producto vacío');
    const invalida = cantidad == null && total == null;
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
    const txs = cur ? [...pending, cur] : [...pending];
    txs.forEach((cells, i) => rows.push(buildTx(cells, card, rows.length + i)));
    pending = [];
    cur = null;
  };

  for (const r of allRows) {
    if (SKIP_RE.test(r.text) && !DATE_RE.test(r.cells[0]?.str?.trim() ?? '')) continue;

    if (CONSUMO_RE.test(r.text)) {
      // Línea de subtotal de tarjeta: [code] [titular...] [placa?] Consumo X L/100 Km ...
      const codigo = (r.cells.find((c) => c.x < 70 && /^\d{3,4}$/.test(c.str.trim()))?.str ?? '').trim();
      const nameCells = r.cells.filter((c) => c.x >= 70 && c.x < 213);
      let placa = '';
      const nombreParts: string[] = [];
      for (const c of nameCells) {
        const t = c.str.trim();
        if (looksLikePlate(t)) { placa = t; continue; }
        // Descarta el millaje/kilometraje suelto (1-3 dígitos) que se cuela en la
        // línea de subtotal (p.ej. "0"); conserva los años de 4 dígitos (2022…).
        if (/^\d{1,3}$/.test(t)) continue;
        nombreParts.push(t);
      }
      const titular = nombreParts.join(' ').replace(/\s+/g, ' ').trim();
      const card: TotalEnergiesCard = {
        codigo,
        titular,
        placa: esPlacaReal(placa) ? placa : '',
        es_persona: esPersona(titular, esPlacaReal(placa)),
        cantidad: num(pick(r.cells, COL.cantidad)),
        monto: num(pick(r.cells, COL.total)) ?? num(pick(r.cells, COL.monto)),
      };
      flush(card);
      cards.push(card);
      lastCardIdx = cards.length - 1;
      continue;
    }

    const first = r.cells[0]?.str?.trim() ?? '';
    if (DATE_RE.test(first) || r.cells.some((c) => c.x < 70 && DATE_RE.test(c.str.trim()))) {
      // Inicio de transacción.
      if (cur) pending.push(cur);
      cur = [...r.cells];
      continue;
    }

    // Continuación: de la transacción en curso, o del nombre de la última tarjeta.
    if (cur) {
      cur.push(...r.cells);
    } else if (lastCardIdx >= 0 && r.cells.every((c) => c.x >= 60 && c.x < 155)) {
      // Nombre de tarjeta que sigue en la(s) línea(s) de abajo (p.ej. "2022", "GENERAL").
      const extra = r.cells.map((c) => c.str.trim()).join(' ').trim();
      if (extra) {
        cards[lastCardIdx].titular = `${cards[lastCardIdx].titular} ${extra}`.replace(/\s+/g, ' ').trim();
        cards[lastCardIdx].es_persona = esPersona(cards[lastCardIdx].titular, esPlacaReal(cards[lastCardIdx].placa));
        // Re-etiqueta las filas ya emitidas de esa tarjeta con el titular completo.
        for (const row of rows) {
          if (row.numero_tarjeta === cards[lastCardIdx].codigo) {
            row.titular = cards[lastCardIdx].titular;
            row.titular_es_persona = cards[lastCardIdx].es_persona;
            if (!esPlacaReal(cards[lastCardIdx].placa)) row.identificador = cards[lastCardIdx].titular || cards[lastCardIdx].codigo;
          }
        }
      }
    }
  }
  // Transacciones sin tarjeta (no debería ocurrir): se emiten con su propio identificador.
  if (pending.length || cur) {
    const orphan: TotalEnergiesCard = { codigo: '', titular: '', placa: '', es_persona: false, cantidad: null, monto: null };
    flush(orphan);
  }

  return { rows, header, productos, cards };
}

// Tipos mínimos de pdfjs (evita depender de sus .d.ts en el build).
interface PdfItem { str: string; transform: number[]; }
interface PdfPage { getTextContent(): Promise<{ items: unknown[] }>; }
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; }
