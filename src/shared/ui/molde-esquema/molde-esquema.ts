import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

export interface MoldeTramo {
  lado?: string;
  largo_cm?: number | null;
  alto_cm?: number | null;
  espesor_cm?: number | null;
}

interface Cota { x1: number; y1: number; x2: number; y2: number; label: string; bad: boolean; vertical: boolean; }
interface Geo { rectReal: { x: number; y: number; w: number; h: number }; rectPlano: { x: number; y: number; w: number; h: number } | null; cotas: Cota[]; }

/**
 * BO9 — Esquema autogenerado de un molde. Recibe forma + tramos (cm) y dibuja la
 * planta con cotas (SVG puro, imprimible). Si hay medida de plano, la pinta punteada
 * en gris y marca en rojo la dimensión fuera de tolerancia. Misma implementación
 * para web y app (copiar a csd-app/src/app/shared/ui/, ver PARIDAD.md).
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

  geo = computed<Geo | null>(() => {
    const t = this.tramos()?.[0];
    if (!t) return null;
    const largo = num(t.largo_cm);
    const esp = num(t.espesor_cm) || num(t.alto_cm);
    if (!largo || !esp) return null;

    const plano = this.medidaPlano()?.[0] ?? null;
    const pLargo = plano ? num(plano.largo_cm) : null;
    const pEsp = plano ? num(plano.espesor_cm) || num(plano.alto_cm) : null;
    const tol = this.toleranciaCm();

    // Escala: el mayor de real/plano ocupa ~260px de ancho.
    const maxLargo = Math.max(largo, pLargo ?? 0);
    const maxEsp = Math.max(esp, pEsp ?? 0);
    const scale = Math.min(260 / maxLargo, 90 / maxEsp);
    const ox = 90, oy = 70;
    const wReal = largo * scale, hReal = esp * scale;

    const badLargo = pLargo != null && Math.abs(largo - pLargo) > tol;
    const badEsp = pEsp != null && Math.abs(esp - pEsp) > tol;

    const rectPlano = plano && pLargo && pEsp
      ? { x: ox, y: oy + (hReal - pEsp * scale), w: pLargo * scale, h: pEsp * scale }
      : null;

    const cotas: Cota[] = [
      { x1: ox, y1: oy - 24, x2: ox + wReal, y2: oy - 24,
        label: `${largo} cm${pLargo != null && badLargo ? ` (plano ${pLargo})` : ''}`, bad: badLargo, vertical: false },
      { x1: ox + wReal + 20, y1: oy, x2: ox + wReal + 20, y2: oy + hReal,
        label: `${esp}${pEsp != null && badEsp ? ` (${pEsp})` : ''}`, bad: badEsp, vertical: true },
    ];

    return { rectReal: { x: ox, y: oy, w: wReal, h: hReal }, rectPlano, cotas };
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
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}
