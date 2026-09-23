import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { OrdenTrabajoResumen } from '../../../../shared/models/bitacora.model';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/**
 * BW1 — Lista propia de órdenes de trabajo: buscador (nº/obra/responsable),
 * filtros por obra/fecha/estado, "Mis OT / Todas" según rol y enlace a la ficha.
 * Cierra la nota #65 (no había forma de ver/revisar/compartir las OT creadas).
 */
@Component({
  selector: 'app-orden-trabajo-lista',
  imports: [DatePipe, FormsModule, RouterLink, FilterSelect, Skeleton, TranslatePipe],
  templateUrl: './orden-trabajo-lista.html',
  styleUrl: './orden-trabajo-lista.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdenTrabajoLista implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);

  loading = signal(true);
  error = signal('');
  filas = signal<OrdenTrabajoResumen[]>([]);

  // Filtros.
  busqueda = signal('');
  filObra = signal<string>('');
  filEstado = signal<string>('');
  desde = signal<string>('');
  hasta = signal<string>('');
  soloMias = signal(false);
  puedeVerOtras = signal(false);

  obrasOpts = signal<FilterOption[]>([]);
  readonly ESTADOS_OPTS: FilterOption[] = [
    { value: 'borrador', label: 'Borrador' },
    { value: 'emitida', label: 'Emitida' },
    { value: 'firmada', label: 'Firmada' },
  ];
  readonly ESTADO_LABEL: Record<string, string> = {
    borrador: 'Borrador', emitida: 'Emitida', firmada: 'Firmada',
  };

  /** Filtro de texto client-side sobre lo ya cargado (nº/obra/responsable/descripción). */
  filtradas = computed(() => {
    const q = this.busqueda().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) return this.filas();
    return this.filas().filter((f) => {
      const hay = `${f.codigo} ${f.proyecto ?? ''} ${f.responsable ?? ''} ${f.descripcion ?? ''}`
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  });

  async ngOnInit() {
    try {
      this.puedeVerOtras.set(await this.bitacoraService.puedeVerOtras());
    } catch { this.puedeVerOtras.set(false); }
    // Quien no puede ver otras, ve sólo las suyas (RLS); el toggle no aplica.
    this.soloMias.set(!this.puedeVerOtras());
    try {
      const proyectos = await this.proyectosService.getAll();
      this.obrasOpts.set(proyectos.map((p) => ({ value: p.id, label: p.nombre })));
    } catch { /* filtro opcional */ }
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(await this.bitacoraService.listarOrdenesTrabajo({
        proyecto: this.filObra() || null,
        estado: this.filEstado() || null,
        desde: this.desde() || null,
        hasta: this.hasta() || null,
        soloMias: this.soloMias(),
      }));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las órdenes de trabajo.');
    } finally {
      this.loading.set(false);
    }
  }

  onObra(v: string) { this.filObra.set(v); void this.cargar(); }
  onEstado(v: string) { this.filEstado.set(v); void this.cargar(); }
  onDesde(v: string) { this.desde.set(v); void this.cargar(); }
  onHasta(v: string) { this.hasta.set(v); void this.cargar(); }
  setSoloMias(v: boolean) { this.soloMias.set(v); void this.cargar(); }
}
