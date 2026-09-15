import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

export interface MoldeTramo {
  lado?: string;
  largo_cm?: number | null;
  alto_cm?: number | null;
  espesor_cm?: number | null;
}

type CotaAnchor = 'start' | 'middle' | 'end';
interface Cota {
  x1: number; y1: number; x2: number; y2: number;
  vertical: boolean;
  label: string;
  bad: boolean;
  lx: number; ly: number;
  anchor: CotaAnchor;
}
interface Poly { points: string; }
interface Circ { cx: number; cy: number; r: number; }
interface Line { x1: number; y1: number; x2: number; y2: number; }

interface Geo {
  realPolys: Poly[];
  planoPolys: Poly[];
  realCircles: Circ[];
  planoCircles: Circ[];
  badLines: Line[];      // aristas fuera de tolerancia (rojo) en formas compuestas
  cotas: Cota[];
}

type Place = 'top' | 'bottom' | 'left' | 'right';
type Pt = [number, number];
interface GeomEdge { a: Pt; b: Pt; place: Place; }
interface Geom { pts: Pt[]; edges: GeomEdge[]; lens: number[]; }

/**
 * BO9 / BQ8a — Esquema autogenerado de un molde. Dibuja la planta según `forma`
 * (rectangular · L · T · U · circular) a partir de `tramos` (cm), con cotas por
 * lado. Si hay medida de plano, la pinta punteada en gris y marca en rojo la
 * dimensión/arista fuera de tolerancia. SVG puro (viewBox, escalable, imprimible).
 * Misma implementación para web y app (copiar a csd-app/src/app/shared/ui/, ver PARIDAD.md).
 */
@Component({
  selector: 'app-molde-esquema',
  imports: [],
  templateUrl: './molde-esquema.html',
  styleUrl: './molde-esquema.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoldeEsquema {
  forma = input<string>('rectangular');
  tramos = input<MoldeTramo[]>([]);
  medidaPlano = input<MoldeTramo[] | null>(null);
  toleranciaCm = input<number>(2);

  readonly W = 420;
  readonly H = 220;

  // Caja de dibujo (deja margen alrededor para las cotas).
  private readonly OX = 85;
  private readonly OY = 46;
  private readonly DW = 250;
  private readonly DH = 120;
  private readonly OFF = 20; // separación de la cota respecto a la figura

  geo = computed<Geo | null>(() => {
    const tramos = (this.tramos() ?? []).filter((t): t is MoldeTramo => !!t);
    const plano = this.medidaPlano() ?? null;
    const tol = this.toleranciaCm();
    const forma = (this.forma() || 'rectangular').toLowerCase();
    if (!tramos.length) return null;

    if (forma === 'circular') return this.buildCircular(tramos, plano, tol);
    if (forma === 'l' || forma === 't' || forma === 'u') {
      return this.buildCompound(forma, tramos, plano, tol);
    }
    // rectangular / libre: una sola figura salvo que lleguen varios tramos.
    if (tramos.length > 1) return this.buildStrip(tramos, plano, tol);
    return this.buildRect(tramos, plano, tol);
  });

  desviacion = computed<number | null>(() => {
    const plano = this.medidaPlano();
    const tramos = this.tramos();
    if (!plano?.length) return null;
    let max = 0;
    tramos.forEach((t, i) => {
      const p = plano[i];
      if (!p) return;
      max = Math.max(max,
        Math.abs(num(t.largo_cm) - num(p.largo_cm)),
        Math.abs(num(t.alto_cm) - num(p.alto_cm)),
        Math.abs(num(t.espesor_cm) - num(p.espesor_cm)));
    });
    return max;
  });

  fueraTolerancia = computed(() => {
    const d = this.desviacion();
    return d != null && d > this.toleranciaCm();
  });

  // ── Rectangular (planta largo × alto + espesor como doble muro/cota) ──────
  private buildRect(tramos: MoldeTramo[], plano: MoldeTramo[] | null, tol: number): Geo | null {
    const t0 = tramos[0];
    const largo = num(t0.largo_cm);
    const alto = num(t0.alto_cm);
    const esp = num(t0.espesor_cm);
    const vert = alto > 0 ? alto : esp; // dimensión vertical de la planta
    if (!largo || !vert) return null;

    const p0 = plano?.[0] ?? null;
    const pLargo = p0 ? num(p0.largo_cm) : null;
    const pAlto = p0 ? num(p0.alto_cm) : null;
    const pEsp = p0 ? num(p0.espesor_cm) : null;
    // valor vertical del plano homólogo al que dibujamos
    const pVert = p0 ? (num(p0.alto_cm) > 0 ? num(p0.alto_cm) : num(p0.espesor_cm)) : null;

    const maxW = Math.max(largo, pLargo ?? 0);
    const maxH = Math.max(vert, pVert ?? 0);
    const scale = Math.min(this.DW / maxW, this.DH / maxH);
    const wReal = largo * scale;
    const hReal = vert * scale;
    const ox = this.OX + (this.DW - wReal) / 2;
    const oy = this.OY + (this.DH - hReal) / 2;

    const realPolys: Poly[] = [rectPts(ox, oy, wReal, hReal)];

    // Espesor como tercera dimensión: doble muro cuando alto y espesor son ambos > 0.
    const showWall = esp > 0 && alto > 0;
    let wallPx = 0;
    if (showWall) {
      wallPx = clamp(esp * scale, 3, Math.min(wReal, hReal) * 0.4);
      realPolys.push(rectPts(ox + wallPx, oy + wallPx, wReal - 2 * wallPx, hReal - 2 * wallPx));
    }

    const planoPolys: Poly[] = [];
    if (p0 && pLargo && pVert) {
      planoPolys.push(rectPts(ox, oy, pLargo * scale, pVert * scale));
    }

    const altoUsed = alto > 0 ? alto : esp;
    const pAltoUsed = alto > 0 ? pAlto : pEsp;
    const badLargo = pLargo != null && Math.abs(largo - pLargo) > tol;
    const badAlto = pAltoUsed != null && Math.abs(altoUsed - pAltoUsed) > tol;
    const badEsp = pEsp != null && Math.abs(esp - pEsp) > tol;

    const cotas: Cota[] = [
      // largo (arriba)
      { x1: ox, y1: oy - this.OFF, x2: ox + wReal, y2: oy - this.OFF, vertical: false,
        label: dimLabel(largo, badLargo ? pLargo : null), bad: badLargo,
        lx: ox + wReal / 2, ly: oy - this.OFF - 6, anchor: 'middle' },
      // alto (derecha)
      { x1: ox + wReal + this.OFF, y1: oy, x2: ox + wReal + this.OFF, y2: oy + hReal, vertical: true,
        label: dimLabel(altoUsed, badAlto ? pAltoUsed : null), bad: badAlto,
        lx: ox + wReal + this.OFF + 6, ly: oy + hReal / 2 + 4, anchor: 'start' },
    ];

    // espesor: solo como cota propia cuando es una 3ª dimensión real (muro dibujado).
    if (showWall) {
      const ey = oy + hReal * 0.5;
      cotas.push({
        x1: ox, y1: ey, x2: ox + wallPx, y2: ey, vertical: false,
        label: 'esp ' + dimLabel(esp, badEsp ? pEsp : null), bad: badEsp,
        lx: ox + wallPx + 6, ly: ey + 4, anchor: 'start',
      });
    }

    return { realPolys, planoPolys, realCircles: [], planoCircles: [], badLines: [], cotas };
  }

  // ── Circular (Ø = largo_cm, espesor = anillo interior) ───────────────────
  private buildCircular(tramos: MoldeTramo[], plano: MoldeTramo[] | null, tol: number): Geo | null {
    const t0 = tramos[0];
    const d = num(t0.largo_cm);
    const esp = num(t0.espesor_cm) || num(t0.alto_cm);
    if (!d) return null;

    const p0 = plano?.[0] ?? null;
    const pD = p0 ? num(p0.largo_cm) : null;
    const pEsp = p0 ? (num(p0.espesor_cm) || num(p0.alto_cm)) : null;

    const maxD = Math.max(d, pD ?? 0);
    const scale = Math.min(this.DW, this.DH, 150) / maxD;
    const cx = this.W / 2;
    const cy = this.OY + this.DH / 2;
    const r = (d / 2) * scale;

    const realCircles: Circ[] = [{ cx, cy, r }];
    let rInner = 0;
    if (esp > 0) {
      const wallPx = clamp(esp * scale, 2, r * 0.8);
      rInner = r - wallPx;
      if (rInner > 1) realCircles.push({ cx, cy, r: rInner });
    }
    const planoCircles: Circ[] = pD ? [{ cx, cy, r: (pD / 2) * scale }] : [];

    const badD = pD != null && Math.abs(d - pD) > tol;
    const badEsp = pEsp != null && Math.abs(esp - pEsp) > tol;

    const cotas: Cota[] = [
      // diámetro (línea horizontal por el centro)
      { x1: cx - r, y1: cy, x2: cx + r, y2: cy, vertical: false,
        label: 'Ø ' + dimLabel(d, badD ? pD : null), bad: badD,
        lx: cx, ly: cy - 8, anchor: 'middle' },
    ];
    if (rInner > 1) {
      // espesor: cota radial del muro (arriba)
      cotas.push({
        x1: cx, y1: cy - r, x2: cx, y2: cy - rInner, vertical: true,
        label: 'esp ' + dimLabel(esp, badEsp ? pEsp : null), bad: badEsp,
        lx: cx + 6, ly: cy - r + (r - rInner) / 2 + 4, anchor: 'start',
      });
    }

    return { realPolys: [], planoPolys: [], realCircles, planoCircles, badLines: [], cotas };
  }

  // ── Compuesta L / T / U (polígono por plantilla, cota por lado) ──────────
  private buildCompound(forma: string, tramos: MoldeTramo[], plano: MoldeTramo[] | null, tol: number): Geo | null {
    const dR = derive(tramos);
    const geomR = geomPoints(forma, dR);
    if (!geomR) return this.buildStrip(tramos, plano, tol);

    const dP = plano && plano.length ? derive(plano) : null;
    const geomP = dP ? geomPoints(forma, dP) : null;

    // bbox sobre la unión real + plano para que ambos quepan.
    const all: Pt[] = [...geomR.pts, ...(geomP?.pts ?? [])];
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = (Math.max(...xs) - minX) || 1;
    const h = (Math.max(...ys) - minY) || 1;
    const scale = Math.min(this.DW / w, this.DH / h);
    const ox = this.OX + (this.DW - w * scale) / 2;
    const oy = this.OY + (this.DH - h * scale) / 2;
    const tf = (p: Pt): Pt => [ox + (p[0] - minX) * scale, oy + (p[1] - minY) * scale];

    const realPolys: Poly[] = [{ points: geomR.pts.map(tf).map((p) => p.join(',')).join(' ') }];
    const planoPolys: Poly[] = geomP
      ? [{ points: geomP.pts.map(tf).map((p) => p.join(',')).join(' ') }]
      : [];

    const badLines: Line[] = [];
    const cotas: Cota[] = [];
    geomR.edges.forEach((edge, i) => {
      const a = tf(edge.a);
      const b = tf(edge.b);
      const realLen = geomR.lens[i];
      const planoLen = geomP ? geomP.lens[i] : null;
      const bad = planoLen != null && Math.abs(realLen - planoLen) > tol;
      if (bad) badLines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      const ladoTxt = tramos[i]?.lado;
      const lado = ladoTxt ? `${ladoTxt}: ` : '';
      cotas.push(this.cotaFor(a, b, edge.place, lado + dimLabel(realLen, bad ? planoLen : null), bad));
    });

    return { realPolys, planoPolys, realCircles: [], planoCircles: [], badLines, cotas };
  }

  // ── Tira: varios tramos rectangulares lado a lado (fallback multi-tramo) ──
  private buildStrip(tramos: MoldeTramo[], plano: MoldeTramo[] | null, tol: number): Geo | null {
    const rects = tramos
      .map((tr, i) => ({ i, w: num(tr.largo_cm), h: num(tr.alto_cm) || num(tr.espesor_cm) }))
      .filter((r) => r.w > 0);
    if (!rects.length) return null;

    const maxW = Math.max(...rects.map((r) => r.w));
    const gap = maxW * 0.12;
    const totalW = rects.reduce((s, r) => s + r.w, 0) + gap * (rects.length - 1);
    const maxH = Math.max(...rects.map((r) => r.h || maxW * 0.5));

    const scale = Math.min(this.DW / totalW, this.DH / maxH);
    const oy = this.OY + (this.DH - maxH * scale) / 2;
    let cxCursor = this.OX + (this.DW - totalW * scale) / 2;

    const realPolys: Poly[] = [];
    const planoPolys: Poly[] = [];
    const cotas: Cota[] = [];
    rects.forEach((r) => {
      const wPx = r.w * scale;
      const hPx = (r.h || maxW * 0.5) * scale;
      const x = cxCursor;
      realPolys.push(rectPts(x, oy, wPx, hPx));

      const p = plano?.[r.i] ?? null;
      const pLargo = p ? num(p.largo_cm) : null;
      if (p && pLargo) planoPolys.push(rectPts(x, oy, pLargo * scale, hPx));
      const bad = pLargo != null && Math.abs(r.w - pLargo) > tol;
      const ladoTxt = tramos[r.i]?.lado;
      const lado = ladoTxt ? `${ladoTxt}: ` : '';
      cotas.push({
        x1: x, y1: oy - this.OFF, x2: x + wPx, y2: oy - this.OFF, vertical: false,
        label: lado + dimLabel(r.w, bad ? pLargo : null), bad,
        lx: x + wPx / 2, ly: oy - this.OFF - 6, anchor: 'middle',
      });
      cxCursor += wPx + gap * scale;
    });

    return { realPolys, planoPolys, realCircles: [], planoCircles: [], badLines: [], cotas };
  }

  private cotaFor(a: Pt, b: Pt, place: Place, label: string, bad: boolean): Cota {
    const OFF = this.OFF;
    if (place === 'top') {
      const y = Math.min(a[1], b[1]) - OFF;
      return { x1: a[0], y1: y, x2: b[0], y2: y, vertical: false, label, bad,
        lx: (a[0] + b[0]) / 2, ly: y - 6, anchor: 'middle' };
    }
    if (place === 'bottom') {
      const y = Math.max(a[1], b[1]) + OFF;
      return { x1: a[0], y1: y, x2: b[0], y2: y, vertical: false, label, bad,
        lx: (a[0] + b[0]) / 2, ly: y + 14, anchor: 'middle' };
    }
    if (place === 'left') {
      const x = Math.min(a[0], b[0]) - OFF;
      return { x1: x, y1: a[1], x2: x, y2: b[1], vertical: true, label, bad,
        lx: x - 6, ly: (a[1] + b[1]) / 2 + 4, anchor: 'end' };
    }
    const x = Math.max(a[0], b[0]) + OFF;
    return { x1: x, y1: a[1], x2: x, y2: b[1], vertical: true, label, bad,
      lx: x + 6, ly: (a[1] + b[1]) / 2 + 4, anchor: 'start' };
  }
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fmt(n: number): number {
  return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

/** Etiqueta de cota: "58 cm" o "58 (plano 60) cm" cuando está fuera de tolerancia. */
function dimLabel(real: number, plano: number | null): string {
  return plano != null ? `${fmt(real)} (plano ${fmt(plano)}) cm` : `${fmt(real)} cm`;
}

function rectPts(x: number, y: number, w: number, h: number): Poly {
  return { points: `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}` };
}

/** Deriva A/B/C (lados) + espesor de la lista de tramos. Un solo tramo → usa
 * largo/alto/espesor del mismo; varios → un largo por tramo. */
function derive(tramos: MoldeTramo[]): { A: number; B: number; C: number; t: number } {
  const single = tramos.length <= 1;
  let A: number, B: number, C: number, esp: number;
  if (single) {
    const t0 = tramos[0] ?? {};
    A = num(t0.largo_cm);
    B = num(t0.alto_cm) || A;
    C = B;
    esp = num(t0.espesor_cm);
  } else {
    A = num(tramos[0]?.largo_cm);
    B = num(tramos[1]?.largo_cm) || A;
    C = num(tramos[2]?.largo_cm) || B;
    esp = num(tramos[0]?.espesor_cm) || num(tramos[0]?.alto_cm);
  }
  const maxLen = Math.max(A, B, C, 1);
  let t = esp > 0 ? esp : maxLen * 0.22;
  t = clamp(t, maxLen * 0.06, maxLen * 0.45);
  return { A, B, C, t };
}

/** Plantilla del polígono por forma. Devuelve puntos (cm), aristas acotables y
 * la longitud (cm) que representa cada arista. */
function geomPoints(forma: string, d: { A: number; B: number; C: number; t: number }): Geom | null {
  const { A, B, C, t } = d;
  if (!A) return null;
  switch (forma) {
    case 'l':
      return {
        pts: [[0, 0], [A, 0], [A, t], [t, t], [t, B], [0, B]],
        edges: [
          { a: [0, 0], b: [A, 0], place: 'top' },
          { a: [0, 0], b: [0, B], place: 'left' },
        ],
        lens: [A, B],
      };
    case 't': {
      const cx = A / 2;
      const half = t / 2;
      return {
        pts: [[0, 0], [A, 0], [A, t], [cx + half, t], [cx + half, t + B], [cx - half, t + B], [cx - half, t], [0, t]],
        edges: [
          { a: [0, 0], b: [A, 0], place: 'top' },
          { a: [cx + half, t], b: [cx + half, t + B], place: 'right' },
        ],
        lens: [A, B],
      };
    }
    case 'u': {
      const Hh = Math.max(B, C);
      return {
        pts: [[0, Hh - B], [t, Hh - B], [t, Hh], [A - t, Hh], [A - t, Hh - C], [A, Hh - C], [A, Hh + t], [0, Hh + t]],
        edges: [
          { a: [0, Hh + t], b: [A, Hh + t], place: 'bottom' },
          { a: [0, Hh - B], b: [0, Hh + t], place: 'left' },
          { a: [A, Hh - C], b: [A, Hh + t], place: 'right' },
        ],
        lens: [A, B, C],
      };
    }
    default:
      return null;
  }
}
