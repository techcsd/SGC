import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TecnologiaService, LeerCotizacionResultado } from '../../../../shared/services/tecnologia.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { TecCotizacion, TecEquipo, TecCompraOpcion } from '../../../../shared/models/tecnologia.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

type Filtro = 'all' | 'sin_vincular' | 'con_compra' | 'con_equipo';

@Component({
  selector: 'app-tec-cotizaciones',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Icon, FileUpload, DecimalPipe, TranslatePipe],
  templateUrl: './cotizaciones.html',
  styleUrl: './cotizaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecCotizaciones implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  formatTimestamp = formatTimestampDisplay;

  cotizaciones = signal<TecCotizacion[]>([]);
  loading = signal(true);
  error = signal('');

  query = signal('');
  filtro = signal<Filtro>('all');

  cotizacionesFiltradas = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filtro();
    return this.cotizaciones().filter((c) => {
      if (f === 'sin_vincular' && ((c.compras ?? []).length > 0 || (c.equipos ?? []).length > 0)) return false;
      if (f === 'con_compra' && (c.compras ?? []).length === 0) return false;
      if (f === 'con_equipo' && (c.equipos ?? []).length === 0) return false;
      if (!q) return true;
      return c.titulo.toLowerCase().includes(q) || (c.proveedor ?? '').toLowerCase().includes(q);
    });
  });
  conteo(f: Filtro): number {
    if (f === 'all') return this.cotizaciones().length;
    if (f === 'sin_vincular') return this.cotizaciones().filter((c) => (c.compras ?? []).length === 0 && (c.equipos ?? []).length === 0).length;
    if (f === 'con_compra') return this.cotizaciones().filter((c) => (c.compras ?? []).length > 0).length;
    return this.cotizaciones().filter((c) => (c.equipos ?? []).length > 0).length;
  }

  equiposCatalogo = signal<TecEquipo[]>([]);
  comprasOpciones = signal<TecCompraOpcion[]>([]);

  // ── Crear ──────────────────────────────────────────────────────────────
  createOpen = signal(false);
  guardando = signal(false);
  leyendoArchivo = signal(false);
  archivoPendiente = signal<File | null>(null);
  lecturaIA = signal<LeerCotizacionResultado | null>(null);

  form = new FormGroup({
    titulo: new FormControl<string>('', { nonNullable: true }),
    proveedor: new FormControl<string | null>(null),
    fecha: new FormControl<string | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP', { nonNullable: true }),
    subtotal: new FormControl<number | null>(null),
    itbis: new FormControl<number | null>(null),
    total: new FormControl<number | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // ── Detalle ──────────────────────────────────────────────────────────────
  detailOpen = signal(false);
  detail = signal<TecCotizacion | null>(null);
  archivoUrl = signal<string | null>(null);
  equipoBusqueda = signal('');
  equipoSeleccionado = signal<string>('');
  compraSeleccionada = signal<string>('');
  guardandoDetalle = signal(false);
  editando = signal(false);
  editForm = new FormGroup({
    titulo: new FormControl<string>('', { nonNullable: true }),
    proveedor: new FormControl<string | null>(null),
    fecha: new FormControl<string | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP', { nonNullable: true }),
    subtotal: new FormControl<number | null>(null),
    itbis: new FormControl<number | null>(null),
    total: new FormControl<number | null>(null),
    notas: new FormControl<string | null>(null),
  });

  equiposFiltrados = computed(() => {
    const q = this.equipoBusqueda().trim().toLowerCase();
    const yaVinculados = new Set((this.detail()?.equipos ?? []).map((e) => e.equipo_id));
    return this.equiposCatalogo()
      .filter((e) => !yaVinculados.has(e.id))
      .filter((e) => !q || e.nombre.toLowerCase().includes(q) || (e.codigo ?? '').toLowerCase().includes(q))
      .slice(0, 30);
  });
  comprasDisponibles = computed(() => {
    const yaVinculadas = new Set((this.detail()?.compras ?? []).map((c) => c.solicitud_compra_id));
    return this.comprasOpciones().filter((c) => !yaVinculadas.has(c.id));
  });

  async ngOnInit() {
    await this.cargar();
    void this.cargarCatalogos();
    // DZ-02/DZ-06 — enlaces desde la ficha de una compra o de un equipo (?id=)
    // abren la cotización directamente (mismo patrón que Compras, AT11).
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      const c = this.cotizaciones().find((x) => x.id === id);
      if (c) await this.abrirDetalle(c);
    }
  }

  private async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.cotizaciones.set(await this.tecnologia.getCotizaciones());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la biblioteca de cotizaciones.');
    } finally {
      this.loading.set(false);
    }
  }
  private async cargarCatalogos() {
    try {
      this.equiposCatalogo.set(await this.tecnologia.getEquipos());
    } catch { /* best-effort */ }
    try {
      this.comprasOpciones.set(await this.tecnologia.getComprasTecOpciones());
    } catch { /* best-effort */ }
  }

  // ── Crear ──────────────────────────────────────────────────────────────
  abrirCrear() {
    this.form.reset({ titulo: '', proveedor: null, fecha: null, moneda: 'DOP', subtotal: null, itbis: null, total: null, notas: null });
    this.archivoPendiente.set(null);
    this.lecturaIA.set(null);
    this.createOpen.set(true);
  }
  cerrarCrear() {
    this.createOpen.set(false);
  }

  async onArchivoAdd(files: File[]) {
    const file = files[0];
    if (!file) return;
    this.archivoPendiente.set(file);
    this.leyendoArchivo.set(true);
    try {
      const res = await this.tecnologia.leerCotizacion(file);
      this.lecturaIA.set(res);
      if (res.ok && res.lectura) {
        const l = res.lectura as { titulo?: string; proveedor?: string; fecha?: string; moneda?: 'DOP' | 'USD'; subtotal?: number; itbis?: number; total?: number };
        this.form.patchValue({
          titulo: l.titulo || this.form.getRawValue().titulo || file.name,
          proveedor: l.proveedor ?? this.form.getRawValue().proveedor,
          fecha: l.fecha ?? this.form.getRawValue().fecha,
          moneda: l.moneda ?? this.form.getRawValue().moneda,
          subtotal: l.subtotal ?? this.form.getRawValue().subtotal,
          itbis: l.itbis ?? this.form.getRawValue().itbis,
          total: l.total ?? this.form.getRawValue().total,
        });
      }
    } catch {
      // Nunca bloquea: el usuario llena a mano (DZ-07).
    } finally {
      this.leyendoArchivo.set(false);
    }
  }
  quitarArchivo() {
    this.archivoPendiente.set(null);
    this.lecturaIA.set(null);
  }

  async guardar() {
    const v = this.form.getRawValue();
    if (!v.titulo.trim()) {
      this.toast.error('El título es obligatorio');
      return;
    }
    this.guardando.set(true);
    try {
      const archivo = this.archivoPendiente();
      const lectura = this.lecturaIA();
      await this.tecnologia.crearCotizacion(
        { titulo: v.titulo, proveedor: v.proveedor, fecha: v.fecha, moneda: v.moneda, subtotal: v.subtotal, itbis: v.itbis, total: v.total, notas: v.notas },
        archivo ? { file: archivo, lectura: lectura?.lectura ?? null, lecturaCostoUsd: lectura?.costo_usd ?? null } : undefined,
      );
      this.toast.success('Cotización guardada');
      this.createOpen.set(false);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar la cotización');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Detalle ──────────────────────────────────────────────────────────────
  async abrirDetalle(c: TecCotizacion) {
    this.detail.set(c);
    this.archivoUrl.set(null);
    this.equipoBusqueda.set('');
    this.equipoSeleccionado.set('');
    this.compraSeleccionada.set('');
    this.editando.set(false);
    this.detailOpen.set(true);
    if (c.archivo_path) {
      try {
        this.archivoUrl.set(await this.tecnologia.getCotizacionUrl(c.archivo_path));
      } catch { /* best-effort */ }
    }
  }
  cerrarDetalle() {
    this.detailOpen.set(false);
  }

  private async refrescarDetalle(id: string) {
    const actualizada = await this.tecnologia.getCotizacionById(id);
    if (actualizada) this.detail.set(actualizada);
    await this.cargar();
  }

  abrirEdicion(c: TecCotizacion) {
    this.editForm.reset({
      titulo: c.titulo, proveedor: c.proveedor, fecha: c.fecha, moneda: c.moneda,
      subtotal: c.subtotal, itbis: c.itbis, total: c.total, notas: c.notas,
    });
    this.editando.set(true);
  }
  cancelarEdicion() {
    this.editando.set(false);
  }
  async guardarEdicion() {
    const c = this.detail();
    if (!c) return;
    const v = this.editForm.getRawValue();
    if (!v.titulo.trim()) {
      this.toast.error('El título es obligatorio');
      return;
    }
    this.guardandoDetalle.set(true);
    try {
      await this.tecnologia.actualizarCotizacion(c.id, {
        titulo: v.titulo, proveedor: v.proveedor, fecha: v.fecha, moneda: v.moneda,
        subtotal: v.subtotal, itbis: v.itbis, total: v.total, notas: v.notas,
      });
      this.editando.set(false);
      await this.refrescarDetalle(c.id);
      this.toast.success('Cotización actualizada');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    } finally {
      this.guardandoDetalle.set(false);
    }
  }

  async descartar(c: TecCotizacion) {
    try {
      await this.tecnologia.descartarCotizacion(c.id);
      await this.refrescarDetalle(c.id);
      this.toast.success('Cotización descartada');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo descartar');
    }
  }
  async restaurar(c: TecCotizacion) {
    try {
      await this.tecnologia.restaurarCotizacion(c.id);
      await this.refrescarDetalle(c.id);
      this.toast.success('Cotización restaurada');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo restaurar');
    }
  }

  async vincularCompra() {
    const c = this.detail();
    const id = this.compraSeleccionada();
    if (!c || !id) return;
    try {
      await this.tecnologia.vincularCotizacionCompra(c.id, id);
      this.compraSeleccionada.set('');
      await this.refrescarDetalle(c.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo vincular la compra');
    }
  }
  async desvincularCompra(solicitudId: string) {
    const c = this.detail();
    if (!c) return;
    try {
      await this.tecnologia.desvincularCotizacionCompra(c.id, solicitudId);
      await this.refrescarDetalle(c.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo desvincular');
    }
  }
  async vincularEquipo() {
    const c = this.detail();
    const id = this.equipoSeleccionado();
    if (!c || !id) return;
    try {
      await this.tecnologia.vincularCotizacionEquipo(c.id, id);
      this.equipoSeleccionado.set('');
      this.equipoBusqueda.set('');
      await this.refrescarDetalle(c.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo vincular el equipo');
    }
  }
  async desvincularEquipo(equipoId: string) {
    const c = this.detail();
    if (!c) return;
    try {
      await this.tecnologia.desvincularCotizacionEquipo(c.id, equipoId);
      await this.refrescarDetalle(c.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo desvincular el equipo');
    }
  }

  // ── Helpers de presentación ────────────────────────────────────────────
  nombreCompra(solicitudId: string): string {
    return this.comprasOpciones().find((c) => c.id === solicitudId)?.label ?? 'Compra tecnológica';
  }
  nombreEquipo(equipoId: string): string {
    const e = this.equiposCatalogo().find((x) => x.id === equipoId);
    return e ? (e.codigo ? `${e.codigo} — ${e.nombre}` : e.nombre) : 'Equipo';
  }
  tonoEstado(estado: TecCotizacion['estado']): 'success' | 'info' | 'neutral' {
    if (estado === 'usada') return 'success';
    if (estado === 'descartada') return 'neutral';
    return 'info';
  }
  labelEstado(estado: TecCotizacion['estado']): string {
    if (estado === 'usada') return 'Usada';
    if (estado === 'descartada') return 'Descartada';
    return 'Vigente';
  }
}
