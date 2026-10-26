import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { OdooApiService } from '../../services/odoo-api.service';
import { OdooProductoCompra } from '../../models/odoo.model';
import { Icon } from '../icon/icon';
import { TranslatePipe } from '../../i18n/translate.pipe';

const MIN_BUSQUEDA = 2;
const DEBOUNCE_MS = 300;

/**
 * CY24 (#24, D1/E1/E2/E8) — selector de producto de Odoo para una línea de OC.
 * Mismo patrón de búsqueda que el PoC "Stock en Odoo" (debounce + descarte de
 * respuestas viejas por secuencia), pero para elegir UN producto por renglón
 * en vez de filtrar una tabla. Sin resultados (E1): exige confirmar "ya busqué
 * y no existe" antes de habilitar "Solicitar alta" (anti-duplicado). Un error
 * de Odoo (E8) se muestra tal cual — sin fallback al catálogo de SGC.
 */
@Component({
  selector: 'app-odoo-producto-picker',
  imports: [Icon, TranslatePipe],
  templateUrl: './odoo-producto-picker.html',
  styleUrl: './odoo-producto-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdooProductoPicker {
  private odoo = inject(OdooApiService);

  value = input<OdooProductoCompra | null>(null);
  disabled = input<boolean>(false);

  selectionChange = output<OdooProductoCompra | null>();
  /** Emite el término ya buscado y confirmado "no existe" (criterio 7: anti-duplicado). */
  solicitarAlta = output<string>();

  termino = signal('');
  sugerencias = signal<OdooProductoCompra[]>([]);
  buscando = signal(false);
  errorBusqueda = signal(false);
  activo = signal(-1);
  confirmoNoExiste = signal(false);

  private seqBusqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  onTexto(valor: string) {
    this.termino.set(valor);
    this.confirmoNoExiste.set(false);
    this.activo.set(-1);
    if (this.temporizador) clearTimeout(this.temporizador);
    if (valor.trim().length < MIN_BUSQUEDA) {
      this.seqBusqueda++;
      this.sugerencias.set([]);
      this.buscando.set(false);
      this.errorBusqueda.set(false);
      return;
    }
    this.buscando.set(true);
    this.temporizador = setTimeout(() => void this.buscar(valor.trim()), DEBOUNCE_MS);
  }

  private async buscar(valor: string) {
    const id = ++this.seqBusqueda;
    this.errorBusqueda.set(false);
    try {
      const encontrados = await this.odoo.buscarProductosCompra(valor);
      if (id !== this.seqBusqueda) return;
      this.sugerencias.set(encontrados);
    } catch {
      // E8 — un fallo de Odoo no cae a un fallback de sgc.articulos; se avisa y punto.
      if (id !== this.seqBusqueda) return;
      this.sugerencias.set([]);
      this.errorBusqueda.set(true);
    } finally {
      if (id === this.seqBusqueda) this.buscando.set(false);
    }
  }

  onTeclas(ev: KeyboardEvent) {
    const n = this.sugerencias().length;
    if (ev.key === 'Escape') {
      this.sugerencias.set([]);
      this.activo.set(-1);
    } else if (n > 0 && ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.activo.update((i) => (i + 1) % n);
    } else if (n > 0 && ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.activo.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (ev.key === 'Enter' && this.activo() >= 0) {
      ev.preventDefault();
      this.elegir(this.sugerencias()[this.activo()]);
    }
  }

  elegir(p: OdooProductoCompra) {
    this.seqBusqueda++; // cancela cualquier búsqueda en vuelo
    if (this.temporizador) clearTimeout(this.temporizador);
    this.termino.set('');
    this.sugerencias.set([]);
    this.activo.set(-1);
    this.selectionChange.emit(p);
  }

  limpiar() {
    this.selectionChange.emit(null);
    this.termino.set('');
    this.sugerencias.set([]);
    this.confirmoNoExiste.set(false);
  }

  /** E1 — "ya busqué y no existe" antes de habilitar Solicitar alta (anti-duplicado). */
  get sinResultados(): boolean {
    return this.termino().trim().length >= MIN_BUSQUEDA && !this.buscando() && !this.errorBusqueda() && this.sugerencias().length === 0;
  }

  pedirAlta() {
    const termino = this.termino().trim();
    if (!this.confirmoNoExiste() || !termino) return;
    this.solicitarAlta.emit(termino);
    this.termino.set('');
    this.confirmoNoExiste.set(false);
  }
}
