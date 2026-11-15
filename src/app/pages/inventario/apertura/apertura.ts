import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  InventarioAlmacenService,
  InventarioAlmacenItem,
} from '../../../../shared/services/inventario-almacen.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { Bodega } from '../../../../shared/models/bodega.model';
import { UserService } from '../../../core/services/user.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';

/** AT7 — opción de almacén para el selector de apertura (id + nombre + marcadores). */
interface AlmacenOpcion {
  id: string;
  nombre: string;
  es_central: boolean;
  es_prueba: boolean;
}

/**
 * AS10 — Herramienta admin de "Apertura de inventario". Fija el dato de apertura
 * (piso inicial, AP5) por almacén: en lote (todo a una cantidad) o por artículo.
 * La apertura NO genera movimientos, NO pinta en el kardex y re-basa la existencia
 * sin caída (reglas AP5). Server-side es admin-only (set_apertura / _lote).
 */
@Component({
  selector: 'app-apertura-inventario',
  imports: [DecimalPipe, RouterLink, TranslatePipe],
  templateUrl: './apertura.html',
  styleUrl: './apertura.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AperturaInventario implements OnInit {
  private service = inject(InventarioAlmacenService);
  private bodegasService = inject(BodegasService);
  private userService = inject(UserService);
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  // AT7 — lista cruda de almacenes (getAll trae es_prueba); el toggle deriva `almacenes`.
  private bodegasRaw = signal<Bodega[]>([]);
  /** Almacenes activos para el selector; incluye los de prueba solo si el admin activó el toggle. */
  almacenes = computed<AlmacenOpcion[]>(() => {
    // Z5(d) — no-admin: nunca ve prueba. Admin: la oculta salvo que active el toggle.
    const verPrueba = this.esAdmin() && this.mostrarPrueba();
    return this.bodegasRaw()
      .filter((b) => b.activo)
      .filter((b) => !(b.es_prueba && !verPrueba))
      .map((b) => ({
        id: b.id,
        nombre: b.nombre,
        es_central: !!b.es_central, // BO1 — columna fuente-de-verdad (antes es_principal)
        es_prueba: !!b.es_prueba,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });
  bodegaId = signal<string>('');
  items = signal<InventarioAlmacenItem[]>([]);
  loading = signal(false);
  search = signal('');

  // Controles del lote.
  cantidadLote = signal<number>(1000);
  soloFaltantes = signal<boolean>(true);
  aplicandoLote = signal(false);
  // AU6 — catálogo completo: lista/afecta TODOS los artículos del sistema, no solo
  // los que ya se movieron en este almacén.
  incluirCatalogo = signal<boolean>(false);
  previewCount = signal<number | null>(null);

  filtrados = computed(() => {
    const q = this.search().toLowerCase().trim();
    if (!q) return this.items();
    return this.items().filter(
      (i) => i.nombre.toLowerCase().includes(q) || (i.codigo ?? '').toLowerCase().includes(q),
    );
  });

  sinApertura = computed(() => this.items().filter((i) => (i.apertura ?? 0) === 0).length);

  async ngOnInit() {
    if (!this.esAdmin()) {
      this.router.navigate(['/inventario/bodegas']);
      return;
    }
    try {
      this.bodegasRaw.set(await this.bodegasService.getAll());
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudieron cargar los almacenes'), e instanceof Error ? e.message : '');
    }
  }

  async onAlmacen(id: string) {
    this.bodegaId.set(id);
    this.items.set([]);
    this.previewCount.set(null);
    if (!id) return;
    this.loading.set(true);
    try {
      this.items.set(await this.service.getInventario(id, true, null, this.incluirCatalogo()));
      await this.actualizarPreview();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo cargar el inventario'), e instanceof Error ? e.message : '');
    } finally {
      this.loading.set(false);
    }
  }

  /** AU6 — al alternar "todo el catálogo", recarga la lista con/ sin catálogo completo. */
  async toggleCatalogo(v: boolean) {
    this.incluirCatalogo.set(v);
    if (this.bodegaId()) await this.onAlmacen(this.bodegaId());
  }

  async onSoloFaltantes(v: boolean) {
    this.soloFaltantes.set(v);
    await this.actualizarPreview();
  }

  /** AU6 — "Se dará apertura a N artículos" según los filtros actuales del lote. */
  async actualizarPreview() {
    if (!this.bodegaId()) { this.previewCount.set(null); return; }
    try {
      this.previewCount.set(await this.service.previewAperturaLote({
        bodegaId: this.bodegaId(),
        incluirTodoCatalogo: this.incluirCatalogo(),
        soloFaltantes: this.soloFaltantes(),
      }));
    } catch {
      this.previewCount.set(null);
    }
  }

  /** Apertura individual (prompt). */
  async editar(i: InventarioAlmacenItem) {
    const entrada = window.prompt(this.i18n.t('Apertura de "{n}" en este almacén:', { n: i.nombre }), String(i.apertura ?? 0));
    if (entrada == null) return;
    const n = Number(entrada);
    if (Number.isNaN(n) || n < 0) {
      this.toast.error(this.i18n.t('Cantidad inválida.'));
      return;
    }
    try {
      await this.service.setApertura(i.articulo_id, this.bodegaId(), n);
      await this.onAlmacen(this.bodegaId());
      this.toast.success(this.i18n.t('Apertura actualizada.'));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo fijar la apertura.'));
    }
  }

  /** Apertura en lote (todo el almacén a la cantidad indicada). */
  async aplicarLote() {
    if (this.aplicandoLote() || !this.bodegaId()) return;
    const cant = Number(this.cantidadLote());
    if (!Number.isFinite(cant) || cant < 0) {
      this.toast.error(this.i18n.t('Cantidad de apertura inválida.'));
      return;
    }
    const universo = this.incluirCatalogo() ? this.i18n.t('TODO el catálogo del sistema') : this.i18n.t('los artículos de este almacén');
    const alcance = this.soloFaltantes() ? this.i18n.t('sin apertura') : this.i18n.t('(incluye los que ya tienen apertura)');
    const n = this.previewCount();
    const cuantos = n != null ? '\n' + this.i18n.t('Se dará apertura a {n} artículo(s).', { n }) : '';
    const mensaje = this.i18n.t('¿Fijar la apertura en {cant} de {universo} {alcance}?', { cant, universo, alcance })
      + cuantos + '\n' + this.i18n.t('No genera movimientos ni afecta el kardex (re-basa sin caída).');
    if (!confirm(mensaje)) {
      return;
    }
    this.aplicandoLote.set(true);
    try {
      const tocados = await this.service.setAperturaLote({
        bodegaId: this.bodegaId(),
        cantidad: cant,
        soloFaltantes: this.soloFaltantes(),
        incluirTodoCatalogo: this.incluirCatalogo(),
      });
      await this.onAlmacen(this.bodegaId());
      this.toast.success(this.i18n.t('Apertura aplicada en lote'), this.i18n.t('Se actualizó la apertura de {n} artículo(s).', { n: tocados }));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo aplicar la apertura en lote.'));
    } finally {
      this.aplicandoLote.set(false);
    }
  }
}
