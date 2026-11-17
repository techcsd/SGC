// DS-28 — constructor mínimo de PDF (texto Helvetica + imágenes JPEG), sin dependencias.
// Sirve para guardar el PDF firmado del conduce en el servidor. Coordenadas en puntos (A4 595x842).

export type PdfBloque =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'texto'; texto: string; negrita?: boolean }
  | { tipo: 'fila'; cols: string[]; negrita?: boolean }
  | { tipo: 'espacio'; alto?: number }
  | { tipo: 'imagenes'; items: { jpeg: Uint8Array; ancho: number; alto: number; pie: string }[] };

interface PdfStream {
  head: string;
  data: Uint8Array;
}

const W = 595;
const H = 842;
const M = 48;

/** Convierte a WinAnsi (cp1252) escapado para un literal de cadena PDF. */
function ansi(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    const b = c < 256 ? c : 63;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}

function recortar(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '.' : s;
}

export function construirPdf(bloques: PdfBloque[], metaTitulo = 'Conduce'): Uint8Array {
  const enc = new TextEncoder();
  const objetos: (string | PdfStream)[] = []; // índice 0 => objeto 1
  const paginas: { contenido: string; imgs: number[] }[] = [{ contenido: '', imgs: [] }];
  const imagenes: { jpeg: Uint8Array; ancho: number; alto: number }[] = [];
  let y = H - M;
  const pag = () => paginas[paginas.length - 1];
  const nueva = () => {
    paginas.push({ contenido: '', imgs: [] });
    y = H - M;
  };
  const asegurar = (alto: number) => {
    if (y - alto < M) nueva();
  };
  const texto = (t: string, x: number, yy: number, size: number, neg: boolean) => {
    pag().contenido += `BT /${neg ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${ansi(t)}) Tj ET\n`;
  };

  for (const b of bloques) {
    if (b.tipo === 'titulo') {
      asegurar(30);
      y -= 20;
      texto(recortar(b.texto, 70), M, y, 16, true);
      y -= 8;
    } else if (b.tipo === 'texto') {
      // Ajuste simple de línea (~95 caracteres a 10 pt).
      const lineas: string[] = [];
      let linea = '';
      for (const p of b.texto.split(/\s+/)) {
        if ((linea + ' ' + p).trim().length > 95) {
          lineas.push(linea);
          linea = p;
        } else linea = (linea + ' ' + p).trim();
      }
      lineas.push(linea);
      for (const l of lineas) {
        asegurar(14);
        y -= 14;
        texto(l, M, y, 10, !!b.negrita);
      }
    } else if (b.tipo === 'fila') {
      asegurar(14);
      y -= 14;
      const ancho = (W - 2 * M) / b.cols.length;
      b.cols.forEach((c, i) => texto(recortar(c, Math.floor(ancho / 5.2)), M + i * ancho, y, 9, !!b.negrita));
    } else if (b.tipo === 'espacio') {
      y -= b.alto ?? 10;
    } else {
      const n = b.items.length || 1;
      const celda = (W - 2 * M) / n;
      const altoMax = 90;
      asegurar(altoMax + 30);
      b.items.forEach((it, i) => {
        const esc = Math.min((celda - 20) / it.ancho, altoMax / it.alto, 1);
        const w = it.ancho * esc;
        const h = it.alto * esc;
        const x = M + i * celda + 10;
        imagenes.push({ jpeg: it.jpeg, ancho: it.ancho, alto: it.alto });
        const idx = imagenes.length - 1;
        pag().imgs.push(idx);
        pag().contenido += `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(y - h).toFixed(2)} cm /Im${idx} Do Q\n`;
        pag().contenido += `0.4 w ${x.toFixed(2)} ${(y - altoMax - 4).toFixed(2)} m ${(x + celda - 20).toFixed(2)} ${(y - altoMax - 4).toFixed(2)} l S\n`;
        texto(recortar(it.pie, Math.floor((celda - 20) / 5)), x, y - altoMax - 16, 8, false);
      });
      y -= altoMax + 24;
    }
  }

  // Objetos: 1 catálogo, 2 páginas, 3 F1, 4 F2, luego imágenes, luego (página, contenido) por página.
  const primeraImg = 5;
  const primeraPag = primeraImg + imagenes.length;
  const kids = paginas.map((_, i) => `${primeraPag + i * 2} 0 R`).join(' ');
  objetos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[1] = `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`;
  objetos[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  imagenes.forEach((im, i) => {
    objetos[primeraImg - 1 + i] = {
      head: `<< /Type /XObject /Subtype /Image /Width ${im.ancho} /Height ${im.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>`,
      data: im.jpeg,
    };
  });
  paginas.forEach((p, i) => {
    const xo = p.imgs.map((k) => `/Im${k} ${primeraImg + k} 0 R`).join(' ');
    const base = primeraPag + i * 2;
    const bytes = enc.encode(p.contenido);
    objetos[base - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xo} >> >> /Contents ${base + 1} 0 R >>`;
    objetos[base] = { head: `<< /Length ${bytes.length} >>`, data: bytes };
  });

  const partes: Uint8Array[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => {
    partes.push(u);
    pos += u.length;
  };
  const offs: number[] = [];
  push(enc.encode('%PDF-1.4\n'));
  objetos.forEach((o, i) => {
    offs.push(pos);
    push(enc.encode(`${i + 1} 0 obj\n`));
    if (typeof o === 'string') push(enc.encode(o + '\n'));
    else {
      push(enc.encode(o.head + '\nstream\n'));
      push(o.data);
      push(enc.encode('\nendstream\n'));
    }
    push(enc.encode('endobj\n'));
  });
  const xref = pos;
  let t = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) t += String(o).padStart(10, '0') + ' 00000 n \n';
  t += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info << /Title (${ansi(metaTitulo)}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  push(enc.encode(t));
  const out = new Uint8Array(pos);
  let p = 0;
  for (const u of partes) {
    out.set(u, p);
    p += u.length;
  }
  return out;
}
