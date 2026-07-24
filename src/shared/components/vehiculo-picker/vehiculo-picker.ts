import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  input,
  output,
  effect,
  untracked,
  ElementRef,
  forwardRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Vehiculo } from '../../models/vehiculo.model';
import { VehiculosService } from '../../services/vehiculos.service';

/**
 * U6 — Selector de vehículo con FOTO. Reemplaza los `<select>` de texto plano en
 * los flujos de flota (pre-uso/checklists, combustible, rutas). Un `<select>`
 * nativo no puede mostrar imágenes, por eso es un combobox accesible propio.
 *
 * Uso con formularios reactivos: `<app-vehiculo-picker formControlName="vehiculo_id" [vehiculos]="…" />`.
 * Uso suelto (filtros): `[value]` + `(valueChange)`.
 */
@Component({
  selector: 'app-vehiculo-picker',
  imports: [],
  templateUrl: './vehiculo-picker.html',
  styleUrl: './vehiculo-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocClick($event)',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => VehiculoPicker),
      multi: true,
    },
  ],
})
export class VehiculoPicker implements ControlValueAccessor {
  private vehiculosService = inject(VehiculosService);
  private host = inject(ElementRef<HTMLElement>);

  vehiculos = input<Vehiculo[]>([]);
  placeholder = input('Seleccionar vehículo…');
  allowClear = input(false);
  /** Modo suelto (sin formulario): valor controlado por el padre. */
  value = input<string | null | undefined>(undefined);

  valueChange = output<string | null>();

  open = signal(false);
  disabled = signal(false);
  selectedId = signal<string | null>(null);
  private fotoUrls = signal<Record<string, string>>({});

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    // Modo suelto: si el padre pasa [value], mantenerlo sincronizado.
    effect(() => {
      const v = this.value();
      if (v !== undefined) this.selectedId.set(v);
    });
    // Resolver la 1ª foto (URL firmada) de cada vehículo para los thumbnails.
    // Solo depende de vehiculos(); el mapa de URLs se lee sin trackear para no
    // re-disparar el effect en cada resolución (evita bucle de auto-dependencia).
    effect(() => {
      const list = this.vehiculos();
      const loaded = untracked(this.fotoUrls);
      for (const v of list) {
        const first = v.fotos?.[0];
        if (!first || loaded[v.id]) continue;
        // Y6 — el thumb del picker se renderiza a 34px; 96px cubre DPR 2/3 (antes 200, sobredimensionado).
        this.vehiculosService.getFotoUrl(first, { width: 96, quality: 75 }).then((url) => {
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.id]: url }));
        });
      }
    });
  }

  selected = computed(() => this.vehiculos().find((v) => v.id === this.selectedId()) ?? null);

  fotoDe(v: Vehiculo): string | null {
    return this.fotoUrls()[v.id] ?? null;
  }

  vehiculoLabel(v: Vehiculo): string {
    return `${v.placa} — ${v.marca} ${v.modelo}`;
  }

  toggle() {
    if (this.disabled()) return;
    this.open.update((o) => !o);
    if (this.open()) this.onTouched();
  }

  pick(v: Vehiculo) {
    this.selectedId.set(v.id);
    this.open.set(false);
    this.onChange(v.id);
    this.valueChange.emit(v.id);
  }

  clear(event: Event) {
    event.stopPropagation();
    this.selectedId.set(null);
    this.onChange(null);
    this.valueChange.emit(null);
  }

  onDocClick(event: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  // ── ControlValueAccessor ──────────────────────────────────
  writeValue(v: string | null): void {
    this.selectedId.set(v ?? null);
  }
  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
