import { ChangeDetectionStrategy, Component, OnInit, computed, input, model } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { Icon } from '../../ui/icon/icon';

export const TAMANOS_PAGINA_DEFECTO = [10, 25, 50] as const;

/**
 * app-paginador — barra de paginación compartida (DH21): "Mostrando X–Y de N",
 * anterior/siguiente, ir a página, tamaño recordado por pantalla (localStorage,
 * clave por `id`). El componente NO sabe de dónde vienen las filas — el padre
 * hace el `slice()` (o pasa `page()`/`pageSize()` a un RPC con range/offset) y
 * le da `total` (filas totales, no las de la página actual).
 *
 *   <app-paginador id="auditoria.actividad" [total]="filas().length"
 *                  [(page)]="pagina" [(pageSize)]="tamano" />
 */
@Component({
  selector: 'app-paginador',
  imports: [TranslatePipe, Icon, DecimalPipe],
  templateUrl: './paginador.html',
  styleUrl: './paginador.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Paginador implements OnInit {
  /** Clave de localStorage para recordar el tamaño elegido en ESTA pantalla. */
  id = input.required<string>();
  /** Filas totales (no las de la página visible). */
  total = input.required<number>();
  tamanos = input<readonly number[]>(TAMANOS_PAGINA_DEFECTO);

  page = model(1);
  pageSize = model(10);

  totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  rangoInicio = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1));
  rangoFin = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  ngOnInit() {
    const guardado = this.leerTamanoGuardado();
    if (guardado && this.tamanos().includes(guardado)) this.pageSize.set(guardado);
  }

  private clave(): string {
    return `sgc.paginador.tamano.${this.id()}`;
  }

  private leerTamanoGuardado(): number | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.clave()) : null;
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  cambiarTamano(valor: number) {
    this.pageSize.set(valor);
    this.page.set(1);
    try {
      localStorage.setItem(this.clave(), String(valor));
    } catch {
      /* best-effort */
    }
  }

  irA(pagina: number) {
    const max = this.totalPaginas();
    this.page.set(Math.min(Math.max(1, pagina), max));
  }

  anterior() {
    this.irA(this.page() - 1);
  }

  siguiente() {
    this.irA(this.page() + 1);
  }

  onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.anterior(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.siguiente(); }
    else if (e.key === 'Home') { e.preventDefault(); this.irA(1); }
    else if (e.key === 'End') { e.preventDefault(); this.irA(this.totalPaginas()); }
  }
}
