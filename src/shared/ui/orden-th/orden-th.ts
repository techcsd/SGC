import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { OrdenColumna, Direccion } from '../../utils/orden-columnas.util';

/**
 * CS1 — encabezado `<th>` ordenable, compartido entre Inventario › Requisiciones
 * e Ingeniería › Solicitudes de material (antes cada pantalla tenía su propio
 * interruptor de orden, o ninguno). Selector como atributo: reemplaza el `<th>`
 * plano sin cambiar la estructura de la tabla.
 */
@Component({
  selector: 'th[appOrdenTh]',
  imports: [],
  templateUrl: './orden-th.html',
  styleUrl: './orden-th.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-sort]': 'ariaSort()' },
})
export class OrdenTh<K extends string = string> {
  label = input.required<string>();
  clave = input.required<K>();
  orden = input.required<OrdenColumna<K>>();
  /** Dirección a usar la PRIMERA vez que se elige esta columna (luego alterna). */
  dirInicial = input<Direccion>('asc');

  ordenChange = output<OrdenColumna<K>>();

  activa = computed(() => this.orden().clave === this.clave());
  dirActual = computed<Direccion | null>(() => (this.activa() ? this.orden().dir : null));
  flecha = computed(() => (this.dirActual() === 'asc' ? '▲' : this.dirActual() === 'desc' ? '▼' : ''));
  ariaSort = computed(() =>
    !this.activa() ? 'none' : this.dirActual() === 'asc' ? 'ascending' : 'descending',
  );

  alternar() {
    if (this.activa()) {
      const dir: Direccion = this.orden().dir === 'asc' ? 'desc' : 'asc';
      this.ordenChange.emit({ clave: this.clave(), dir });
    } else {
      this.ordenChange.emit({ clave: this.clave(), dir: this.dirInicial() });
    }
  }
}
