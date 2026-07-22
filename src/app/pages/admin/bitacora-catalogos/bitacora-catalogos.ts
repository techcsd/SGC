import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BitacoraCatalogosService,
  BitacoraCatalogo,
} from '../../../../shared/services/bitacora-catalogos.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

type Tipo =
  | 'estructura'
  | 'actividad'
  | 'restriccion'
  | 'suceso_incidente'
  | 'suceso_accidente'
  | 'suceso_equipo';

/** Admin management of the bitácora catalogs (estructuras/actividades/restricciones). */
@Component({
  selector: 'app-admin-bitacora-catalogos',
  imports: [FormsModule, Skeleton],
  templateUrl: './bitacora-catalogos.html',
  styleUrl: './bitacora-catalogos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminBitacoraCatalogos implements OnInit {
  private service = inject(BitacoraCatalogosService);

  readonly grupos: { tipo: Tipo; label: string }[] = [
    { tipo: 'estructura', label: 'Estructuras' },
    { tipo: 'actividad', label: 'Actividades' },
    { tipo: 'restriccion', label: 'Restricciones' },
    { tipo: 'suceso_incidente', label: 'Sucesos de incidente' },
    { tipo: 'suceso_accidente', label: 'Sucesos de accidente' },
    { tipo: 'suceso_equipo', label: 'Sucesos de equipo' },
  ];

  catalogos = signal<BitacoraCatalogo[]>([]);
  loading = signal(true);
  error = signal('');
  nuevoTipo = signal<Tipo>('estructura');
  nuevoValor = signal('');
  saving = signal(false);

  porTipo = computed(() => {
    // Tolerant bucketing: initialize a bucket for every known grupo and lazily
    // create one for any unknown tipo the DB might return (S13 sembró tipos
    // suceso_*; sin esto map[c.tipo].push() reventaba con TypeError y la grilla
    // quedaba vacía).
    const map: Record<string, BitacoraCatalogo[]> = {};
    for (const g of this.grupos) map[g.tipo] = [];
    for (const c of this.catalogos()) (map[c.tipo] ??= []).push(c);
    for (const t of Object.keys(map)) {
      map[t].sort((a, b) => a.orden - b.orden || a.valor.localeCompare(b.valor));
    }
    return map as Record<Tipo, BitacoraCatalogo[]>;
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.catalogos.set(await this.service.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  async agregar() {
    const valor = this.nuevoValor().trim();
    if (!valor || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const c = await this.service.create(this.nuevoTipo(), valor);
      this.catalogos.update((l) => [...l, c]);
      this.nuevoValor.set('');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al agregar.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggle(c: BitacoraCatalogo) {
    const next = !c.activo;
    this.catalogos.update((l) => l.map((x) => (x.id === c.id ? { ...x, activo: next } : x)));
    try {
      await this.service.toggleActivo(c.id, next);
    } catch {
      this.catalogos.update((l) => l.map((x) => (x.id === c.id ? { ...x, activo: !next } : x)));
    }
  }

  /**
   * S2 — reorder a value up/down within its tipo. Normalizes the whole group's
   * orden to 1..n (robust against legacy zeros) and persists the changes.
   */
  async mover(c: BitacoraCatalogo, dir: -1 | 1) {
    if (this.saving()) return;
    const grupo = [...this.porTipo()[c.tipo]];
    const idx = grupo.findIndex((x) => x.id === c.id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= grupo.length) return;
    [grupo[idx], grupo[swap]] = [grupo[swap], grupo[idx]];

    // Reassign sequential orden and collect the ones that changed.
    const cambios = grupo
      .map((x, i) => ({ id: x.id, orden: i + 1, prev: x.orden }))
      .filter((x) => x.orden !== x.prev);
    if (!cambios.length) return;

    const byId = new Map(cambios.map((x) => [x.id, x.orden]));
    this.catalogos.update((l) =>
      l.map((x) => (byId.has(x.id) ? { ...x, orden: byId.get(x.id)! } : x)),
    );
    this.saving.set(true);
    try {
      await Promise.all(cambios.map((x) => this.service.updateOrden(x.id, x.orden)));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo reordenar.');
      await this.load();
    } finally {
      this.saving.set(false);
    }
  }
}
