import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  ElementRef,
  inject,
} from '@angular/core';
import { Icon } from '../icon/icon';

export interface FilterOption { value: string; label: string; }

/**
 * BP6 — Filtro tipo chip + popover con búsqueda. Reemplaza los `<select>` planos.
 * Single (radio) o multi (checkbox). Reutilizable en Personal, Conductores,
 * Requisiciones, Almacenes. Teclado + aria + cierre al hacer clic fuera.
 *
 * Uso single:  [label]="'Obra'" [options]="obras()" [value]="filObra()" (valueChange)="filObra.set($event)"
 * Uso multi:   [label]="'Cargo'" [options]="cargos()" [multiple]="true" [values]="sel()" (valuesChange)="sel.set($event)"
 */
@Component({
  selector: 'app-filter-select',
  imports: [Icon],
  templateUrl: './filter-select.html',
  styleUrl: './filter-select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)' },
})
export class FilterSelect {
  label = input.required<string>();
  options = input<FilterOption[]>([]);
  value = input<string | null>(null);        // single
  values = input<string[]>([]);               // multi
  multiple = input<boolean>(false);
  searchable = input<boolean>(true);
  placeholder = input<string>('Todas');

  valueChange = output<string>();             // single ('' = limpiar)
  valuesChange = output<string[]>();          // multi

  private host = inject(ElementRef<HTMLElement>);
  open = signal(false);
  query = signal('');

  activa = computed(() => (this.multiple() ? this.values().length > 0 : !!this.value()));
  countLabel = computed(() => {
    if (this.multiple()) return this.values().length ? String(this.values().length) : '';
    const v = this.value();
    return v ? (this.options().find((o) => o.value === v)?.label ?? v) : '';
  });

  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter((o) => o.label.toLowerCase().includes(q)) : this.options();
  });

  toggle() {
    this.open.update((v) => !v);
    if (this.open()) this.query.set('');
  }

  isChecked(v: string): boolean {
    return this.multiple() ? this.values().includes(v) : this.value() === v;
  }

  pick(v: string) {
    if (this.multiple()) {
      const cur = this.values();
      this.valuesChange.emit(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    } else {
      this.valueChange.emit(this.value() === v ? '' : v);
      this.open.set(false);
    }
  }

  limpiar(ev: Event) {
    ev.stopPropagation();
    if (this.multiple()) this.valuesChange.emit([]);
    else this.valueChange.emit('');
  }

  onDocClick(ev: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.open.set(false);
  }
}
