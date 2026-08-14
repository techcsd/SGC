import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  InventarioAlmacenService,
  InventarioAlmacenItem,
} from '../../../../shared/services/inventario-almacen.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { KardexModal } from '../kardex-modal/kardex-modal';

/**
 * AP2 — Inventario de un almacén específico: lista de artículos con existencias,
 * buscador y filtro por categoría. Cada artículo tiene botón "Histórico" (kardex,
 * AP3) y, para admin, edición del dato de apertura (AP5) desde aquí (accesible
 * desde el listado de almacenes y desde la vista del proyecto).
 */
@Component({
  selector: 'app-almacen-inventario',
  imports: [DecimalPipe, RouterLink, KardexModal],
  templateUrl: './almacen-inventario.html',
  styleUrl: './almacen-inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlmacenInventario implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(InventarioAlmacenService);
  private bodegasService = inject(BodegasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  esAdmin = computed(() => this.userService.hasRole('admin'));

  bodegaId = signal<string>('');
  bodegaNombre = signal<string>('');
  bodegaProyecto = signal<string | null>(null);
  items = signal<InventarioAlmacenItem[]>([]);
  loading = signal(true);
  error = signal('');

  search = signal('');
  categoria = signal<string>('');
  incluirCero = signal(true);

  // Kardex modal
  kardexArticulo = signal<{ id: string; nombre: string } | null>(null);

  categorias = computed(() => {
    const s = new Set<string>();
    for (const i of this.items()) if (i.categoria) s.add(i.categoria);
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  filtrados = computed(() => {
    const q = this.search().toLowerCase().trim();
    const cat = this.categoria();
    const cero = this.incluirCero();
    return this.items().filter((i) => {
      if (!cero && i.es_cero) return false;
      if (cat && i.categoria !== cat) return false;
      if (q && !(i.nombre.toLowerCase().includes(q) || (i.codigo ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  });

  totalArticulos = computed(() => this.filtrados().length);

  async ngOnInit() {
    // Modo directo (almacen/:id) o por obra (almacen/obra/:proyectoId → su almacén).
    let id = this.route.snapshot.paramMap.get('id') ?? '';
    const proyectoId = this.route.snapshot.paramMap.get('proyectoId');
    if (!id && proyectoId) {
      try {
        const bodegas = await this.bodegasService.getAll();
        const deObra = bodegas.filter(
          (b) => (b as { proyecto_id?: string | null }).proyecto_id === proyectoId,
        );
        const elegida = deObra.find((b) => b.activo !== false) ?? deObra[0];
        if (elegida) id = elegida.id;
        else {
          this.error.set('Esta obra no tiene un almacén asignado.');
          this.loading.set(false);
          return;
        }
      } catch (e: unknown) {
        this.error.set(e instanceof Error ? e.message : 'No se pudo resolver el almacén de la obra.');
        this.loading.set(false);
        return;
      }
    }
    this.bodegaId.set(id);
    await this.load(id);
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [bodega, items] = await Promise.all([
        this.bodegasService.getById(id).catch(() => null),
        this.service.getInventario(id, true),
      ]);
      if (bodega) {
        this.bodegaNombre.set(bodega.nombre);
        this.bodegaProyecto.set((bodega as { proyecto_id?: string | null }).proyecto_id ?? null);
      }
      this.items.set(items);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(v: string) { this.search.set(v); }
  onCategoria(v: string) { this.categoria.set(v); }
  toggleCero() { this.incluirCero.update((v) => !v); }

  abrirKardex(i: InventarioAlmacenItem) {
    this.kardexArticulo.set({ id: i.articulo_id, nombre: i.nombre });
  }
  cerrarKardex() { this.kardexArticulo.set(null); }

  /** AP5 — editar apertura (solo admin). */
  async editarApertura(i: InventarioAlmacenItem) {
    if (!this.esAdmin()) return;
    const actual = i.apertura ?? 0;
    const entrada = window.prompt(
      `Dato de apertura de "${i.nombre}" en este almacén.\n` +
        `Al cambiarlo, la existencia se re-basa a (apertura + movimientos) SIN generar movimiento ni afectar el kardex.`,
      String(actual),
    );
    if (entrada == null) return;
    const nueva = Number(entrada);
    if (Number.isNaN(nueva) || nueva < 0) {
      this.toast.error('Cantidad inválida.');
      return;
    }
    if (nueva === actual) return;
    try {
      await this.service.setApertura(i.articulo_id, this.bodegaId(), nueva);
      this.toast.success('Apertura actualizada.');
      await this.load(this.bodegaId());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar la apertura.');
    }
  }
}
