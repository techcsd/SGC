import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * BQ8(b) — Compositor visual de moldes. El ingeniero arma la formación colocando
 * figuras geométricas (rectángulo · L · T · U · círculo) en un lienzo con rejilla
 * de 5 cm: las mueve (imán a la rejilla), gira 90° y ajusta sus medidas real/plano.
 * El resultado es DATA (`CompositorFigura[]`), no una imagen — cada figura mapea a
 * un molde. `molde-esquema` pinta la ficha con la misma data.
 *
 * SVG + pointer events (sin librería), targets grandes para móvil. Misma
 * implementación para web y app (copiar a csd-app, ver PARIDAD.md — contrato
 * `molde-compositor`).
 */
export type CompositorTipo = 'rect' | 'L' | 'T' | 'U' | 'circle';

export interface CompositorFigura {
  id: number;
  tipo: CompositorTipo;
  x: number;               // posición en el lienzo (px del viewBox), imán a rejilla
  y: number;
  rot: number;             // 0 | 90 | 180 | 270
  largo_cm: number;
  alto_cm: number;
  espesor_cm: number;
  plano_largo_cm?: number | null;
  plano_alto_cm?: number | null;
  plano_espesor_cm?: number | null;
}

interface Vista {
  f: CompositorFigura;
  poly: string | null;     // polígono (rect/L/T/U)
  circle: { cx: number; cy: number; r: number; rInner: number } | null;
  bad: boolean;
  handles: { x: number; y: number }[];
  cx: number; cy: number;  // centro para etiqueta
}

const CATALOGO: Record<CompositorTipo, { label: string; largo: number; alto: number; espesor: number }> = {
  rect:   { label: 'Rectángulo', largo: 40, alto: 25, espesor: 10 },
  L:      { label: 'L',          largo: 45, alto: 45, espesor: 12 },
  T:      { label: 'T',          largo: 50, alto: 40, espesor: 12 },
  U:      { label: 'U',          largo: 50, alto: 40, espesor: 12 },
  circle: { label: 'Círculo',    largo: 40, alto: 40, espesor: 8 },
};

@Component({
  selector: 'app-molde-compositor',
  imports: [DecimalPipe],
  templateUrl: './molde-compositor.html',
  styleUrl: './molde-compositor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoldeCompositor {
  /** Figuras iniciales (para rehidratar un borrador). */
  valorInicial = input<CompositorFigura[]>([]);
  toleranciaCm = input<number>(2);
  /** Emite la lista de figuras cada vez que cambia. */
  cambio = output<CompositorFigura[]>();

  readonly VW = 600;
  readonly VH = 420;
  readonly CM = 2.6;             // px por cm
  readonly GRID = 5 * 2.6;       // rejilla de 5 cm en px

  readonly tipos = Object.entries(CATALOGO).map(([tipo, c]) => ({ tipo: tipo as CompositorTipo, label: c.label }));

  figuras = signal<CompositorFigura[]>([]);
  selId = signal<number | null>(null);
  private uid = 1;

  // Líneas de la rejilla (estáticas).
  readonly gridLines = (() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    for (let x = 0; x <= 600; x += 13) lines.push({ x1: x, y1: 0, x2: x, y2: 420, major: x % 26 === 0 });
    for (let y = 0; y <= 420; y += 13) lines.push({ x1: 0, y1: y, x2: 600, y2: y, major: y % 26 === 0 });
    return lines;
  })();

  constructor() {
    // Rehidrata una sola vez cuando llega un valor inicial no vacío.
    effect(() => {
      const init = this.valorInicial();
      if (init && init.length && this.figuras().length === 0) {
        this.figuras.set(init.map((f) => ({ ...f })));
        this.uid = Math.max(...init.map((f) => f.id), 0) + 1;
      }
    });
  }

  seleccionada = computed(() => this.figuras().find((f) => f.id === this.selId()) ?? null);

  vistas = computed<Vista[]>(() => {
    const sel = this.selId();
    const tol = this.toleranciaCm();
    return this.figuras().map((f) => this.toVista(f, f.id === sel, tol));
  });

  // ── Paleta ────────────────────────────────────────────────────────────────
  agregar(tipo: CompositorTipo) {
    const c = CATALOGO[tipo];
    const n = this.figuras().length;
    const f: CompositorFigura = {
      id: this.uid++, tipo,
      x: this.snap(140 + (n % 3) * 60), y: this.snap(120 + Math.floor(n / 3) * 60), rot: 0,
      largo_cm: c.largo, alto_cm: c.alto, espesor_cm: c.espesor,
      plano_largo_cm: c.largo, plano_alto_cm: c.alto, plano_espesor_cm: c.espesor,
    };
    this.figuras.update((fs) => [...fs, f]);
    this.selId.set(f.id);
    this.emit();
  }

  eliminar() {
    const id = this.selId();
    if (id == null) return;
    this.figuras.update((fs) => fs.filter((f) => f.id !== id));
    this.selId.set(null);
    this.emit();
  }

  rotar() {
    const id = this.selId();
    if (id == null) return;
    this.figuras.update((fs) => fs.map((f) => (f.id === id ? { ...f, rot: ((f.rot + 90) % 360) } : f)));
    this.emit();
  }

  seleccionar(id: number) { this.selId.set(id); }

  editar(campo: keyof CompositorFigura, valor: string) {
    const id = this.selId();
    if (id == null) return;
    const n = parseFloat(valor);
    this.figuras.update((fs) => fs.map((f) => (f.id === id ? { ...f, [campo]: Number.isFinite(n) ? n : 0 } : f)));
    this.emit();
  }

  // ── Arrastre (imán a rejilla) ──────────────────────────────────────────────
  private drag: { id: number; dx: number; dy: number } | null = null;
  private svgEl: SVGSVGElement | null = null;

  onPointerDown(ev: PointerEvent, f: CompositorFigura) {
    ev.preventDefault();
    this.selId.set(f.id);
    this.svgEl = (ev.target as Element).closest('svg');
    const p = this.toSvg(ev);
    this.drag = { id: f.id, dx: p.x - f.x, dy: p.y - f.y };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  }
  onPointerMove(ev: PointerEvent) {
    if (!this.drag) return;
    const p = this.toSvg(ev);
    const x = this.snap(p.x - this.drag.dx);
    const y = this.snap(p.y - this.drag.dy);
    this.figuras.update((fs) => fs.map((f) => (f.id === this.drag!.id ? { ...f, x, y } : f)));
  }
  onPointerUp() { if (this.drag) { this.drag = null; this.emit(); } }

  // Teclado: flechas mueven 5 cm.
  onKey(ev: KeyboardEvent) {
    const id = this.selId();
    if (id == null) return;
    const d = this.GRID;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d],
    };
    const mv = map[ev.key];
    if (!mv) return;
    ev.preventDefault();
    this.figuras.update((fs) => fs.map((f) => (f.id === id ? { ...f, x: this.snap(f.x + mv[0]), y: this.snap(f.y + mv[1]) } : f)));
    this.emit();
  }

  desviacion(f: CompositorFigura): number {
    return Math.max(
      Math.abs(f.largo_cm - (f.plano_largo_cm ?? f.largo_cm)),
      Math.abs(f.alto_cm - (f.plano_alto_cm ?? f.alto_cm)),
      Math.abs(f.espesor_cm - (f.plano_espesor_cm ?? f.espesor_cm)),
    );
  }

  labelTipo(t: CompositorTipo): string { return CATALOGO[t].label; }

  // ── internos ────────────────────────────────────────────────────────────
  private emit() { this.cambio.emit(this.figuras().map((f) => ({ ...f }))); }
  private snap(v: number): number { return Math.round(v / this.GRID) * this.GRID; }

  private toSvg(ev: PointerEvent): { x: number; y: number } {
    const svg = this.svgEl ?? (ev.target as Element).closest('svg');
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * this.VW, y: (ev.clientY - r.top) / r.height * this.VH };
  }

  private toVista(f: CompositorFigura, sel: boolean, tol: number): Vista {
    const bad = this.desviacion(f) > tol;
    const w = f.largo_cm * this.CM;
    const h = (f.tipo === 'circle' ? f.largo_cm : f.alto_cm) * this.CM;
    const handles = [
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
    ];
    if (f.tipo === 'circle') {
      const r = f.largo_cm * this.CM / 2;
      const wall = Math.max(2, Math.min(r * 0.8, f.espesor_cm * this.CM));
      return { f, poly: null, circle: { cx: r, cy: r, r, rInner: r - wall }, bad, handles, cx: r, cy: r };
    }
    return { f, poly: this.poly(f), circle: null, bad, handles, cx: w / 2, cy: h / 2 };
  }

  /** Polígono local (px) por tipo. */
  private poly(f: CompositorFigura): string {
    const L = f.largo_cm * this.CM, A = f.alto_cm * this.CM, E = f.espesor_cm * this.CM;
    const pts: [number, number][] = (() => {
      switch (f.tipo) {
        case 'rect': return [[0, 0], [L, 0], [L, A], [0, A]];
        case 'L':    return [[0, 0], [E, 0], [E, A - E], [L, A - E], [L, A], [0, A]];
        case 'T':    return [[0, 0], [L, 0], [L, E], [(L + E) / 2, E], [(L + E) / 2, A], [(L - E) / 2, A], [(L - E) / 2, E], [0, E]];
        case 'U':    return [[0, 0], [E, 0], [E, A - E], [L - E, A - E], [L - E, 0], [L, 0], [L, A], [0, A]];
        default:     return [[0, 0], [L, 0], [L, A], [0, A]];
      }
    })();
    return pts.map((p) => p.join(',')).join(' ');
  }
}
