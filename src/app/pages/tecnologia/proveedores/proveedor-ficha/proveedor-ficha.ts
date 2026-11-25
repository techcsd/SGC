import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TecProveedoresService, enlaceCorreo, enlaceLlamar, enlaceWhatsapp } from '../../../../../shared/services/tec-proveedores.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { UserService } from '../../../../core/services/user.service';
import {
  TecProveedor,
  TecProveedorCategoria,
  TecProveedorCompraRef,
  TecProveedorContacto,
  TecProveedorCotizacionRef,
  TecProveedorFactura,
  TecProveedorTrabajo,
} from '../../../../../shared/models/tec-proveedor.model';
import { FormDrawer } from '../../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../../shared/ui/icon/icon';
import { FileUpload } from '../../../../../shared/ui/file-upload/file-upload';
import { TranslatePipe } from '../../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../../shared/i18n/i18n.service';
import { formatTimestampDisplay } from '../../../../../shared/utils/fecha.util';
import { presentarError } from '../../../../../shared/utils/friendly-error.util';

type Tab = 'resumen' | 'contactos' | 'trabajos' | 'facturas' | 'vinculados' | 'notas';
type Drawer = 'proveedor' | 'contacto' | 'trabajo' | 'factura' | null;

const SUBMODULO = 'tecnologia.proveedores';

/** EA1 — ficha del proveedor: Resumen · Contactos · Trabajos · Facturas · Cotizaciones/compras · Notas. */
@Component({
  selector: 'app-tec-proveedor-ficha',
  imports: [ReactiveFormsModule, RouterLink, FormDrawer, Skeleton, Icon, FileUpload, DecimalPipe, TranslatePipe],
  templateUrl: './proveedor-ficha.html',
  styleUrl: '../proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecProveedorFicha implements OnInit {
  private svc = inject(TecProveedoresService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private user = inject(UserService);
  protected i18n = inject(I18nService);

  formatFecha = formatTimestampDisplay;
  enlaceLlamar = enlaceLlamar;
  enlaceWhatsapp = enlaceWhatsapp;
  enlaceCorreo = enlaceCorreo;

  puedeOperar = computed(() => this.user.puedeOperarSubmodulo(SUBMODULO));

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'resumen', label: 'Resumen' },
    { key: 'contactos', label: 'Contactos' },
    { key: 'trabajos', label: 'Trabajos' },
    { key: 'facturas', label: 'Facturas' },
    { key: 'vinculados', label: 'Cotizaciones y compras' },
    { key: 'notas', label: 'Notas' },
  ];

  tab = signal<Tab>('resumen');
  loading = signal(true);
  error = signal('');

  proveedor = signal<TecProveedor | null>(null);
  categorias = signal<TecProveedorCategoria[]>([]);
  contactos = signal<TecProveedorContacto[]>([]);
  trabajos = signal<TecProveedorTrabajo[]>([]);
  facturas = signal<TecProveedorFactura[]>([]);
  cotizaciones = signal<TecProveedorCotizacionRef[]>([]);
  compras = signal<TecProveedorCompraRef[]>([]);

  totalFacturado = computed(() =>
    this.facturas().filter((f) => f.estado !== 'anulada').reduce((s, f) => s + (f.monto ?? 0), 0),
  );
  pendienteDePago = computed(() =>
    this.facturas().filter((f) => f.estado === 'pendiente').reduce((s, f) => s + (f.monto ?? 0), 0),
  );

  // ── Drawers ───────────────────────────────────────────────────────────────
  drawer = signal<Drawer>(null);
  editandoId = signal<string | null>(null);
  guardando = signal(false);
  archivoPendiente = signal<File | null>(null);

  formProveedor = new FormGroup({
    nombre: new FormControl<string>('', { nonNullable: true }),
    nombre_comercial: new FormControl<string | null>(null),
    rnc: new FormControl<string | null>(null),
    categoria_id: new FormControl<string | null>(null),
    servicio: new FormControl<string | null>(null),
    etiquetas: new FormControl<string>('', { nonNullable: true }),
    direccion: new FormControl<string | null>(null),
    ciudad: new FormControl<string | null>(null),
    web: new FormControl<string | null>(null),
    estado: new FormControl<'activo' | 'inactivo'>('activo', { nonNullable: true }),
    valoracion: new FormControl<number | null>(null),
  });
  formContacto = new FormGroup({
    nombre: new FormControl<string>('', { nonNullable: true }),
    cargo: new FormControl<string | null>(null),
    telefono: new FormControl<string | null>(null),
    whatsapp: new FormControl<string | null>(null),
    correo: new FormControl<string | null>(null),
    principal: new FormControl<boolean>(false, { nonNullable: true }),
    notas: new FormControl<string | null>(null),
  });
  formTrabajo = new FormGroup({
    titulo: new FormControl<string>('', { nonNullable: true }),
    fecha: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
    costo: new FormControl<number | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP', { nonNullable: true }),
    estado: new FormControl<'cotizado' | 'en_curso' | 'completado' | 'cancelado'>('completado', { nonNullable: true }),
    cotizacion_id: new FormControl<string | null>(null),
    solicitud_compra_id: new FormControl<string | null>(null),
  });
  formFactura = new FormGroup({
    numero: new FormControl<string>('', { nonNullable: true }),
    fecha: new FormControl<string | null>(null),
    monto: new FormControl<number | null>(null),
    itbis: new FormControl<number | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP', { nonNullable: true }),
    estado: new FormControl<'pendiente' | 'pagada' | 'anulada'>('pendiente', { nonNullable: true }),
    fecha_pago: new FormControl<string | null>(null),
    trabajo_id: new FormControl<string | null>(null),
    cotizacion_id: new FormControl<string | null>(null),
    solicitud_compra_id: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });
  notasForm = new FormControl<string>('', { nonNullable: true });

  private get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  async ngOnInit() {
    void this.svc.getCategorias().then((c) => this.categorias.set(c)).catch(() => undefined);
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const p = await this.svc.getProveedor(this.id);
      if (!p) {
        this.error.set(this.i18n.t('Proveedor no encontrado.'));
        return;
      }
      this.proveedor.set(p);
      this.notasForm.setValue(p.notas ?? '');
      const [co, tr, fa, cot, com] = await Promise.all([
        this.svc.getContactos(p.id),
        this.svc.getTrabajos(p.id),
        this.svc.getFacturas(p.id),
        this.svc.getCotizaciones(p.id).catch(() => [] as TecProveedorCotizacionRef[]),
        this.svc.getCompras(p.id).catch(() => [] as TecProveedorCompraRef[]),
      ]);
      this.contactos.set(co);
      this.trabajos.set(tr);
      this.facturas.set(fa);
      this.cotizaciones.set(cot);
      this.compras.set(com);
    } catch (e: unknown) {
      this.error.set(presentarError(e, { pantalla: 'el proveedor' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  volver() {
    void this.router.navigate(['/tecnologia/proveedores']);
  }

  etiquetaTrabajo(e: string): string {
    return ({ cotizado: 'Cotizado', en_curso: 'En curso', completado: 'Completado', cancelado: 'Cancelado' } as Record<string, string>)[e] ?? e;
  }
  etiquetaFactura(e: string): string {
    return ({ pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada' } as Record<string, string>)[e] ?? e;
  }
  tonoFactura(e: string): string {
    return e === 'pagada' ? 'success' : e === 'anulada' ? 'neutral' : 'warning';
  }
  moneda(m: string): string {
    return m === 'USD' ? 'US$' : 'RD$';
  }
  nombreTrabajo(id: string | null): string {
    return this.trabajos().find((t) => t.id === id)?.titulo ?? '';
  }

  // ── Abrir drawers ─────────────────────────────────────────────────────────
  editarProveedor() {
    const p = this.proveedor();
    if (!p) return;
    this.formProveedor.reset({
      nombre: p.nombre, nombre_comercial: p.nombre_comercial, rnc: p.rnc, categoria_id: p.categoria_id,
      servicio: p.servicio, etiquetas: p.etiquetas.join(', '), direccion: p.direccion, ciudad: p.ciudad,
      web: p.web, estado: p.estado, valoracion: p.valoracion,
    });
    this.drawer.set('proveedor');
  }
  nuevoContacto(c?: TecProveedorContacto) {
    this.editandoId.set(c?.id ?? null);
    this.formContacto.reset({
      nombre: c?.nombre ?? '', cargo: c?.cargo ?? null, telefono: c?.telefono ?? null, whatsapp: c?.whatsapp ?? null,
      correo: c?.correo ?? null, principal: c?.principal ?? this.contactos().length === 0, notas: c?.notas ?? null,
    });
    this.drawer.set('contacto');
  }
  nuevoTrabajo(t?: TecProveedorTrabajo) {
    this.editandoId.set(t?.id ?? null);
    this.formTrabajo.reset({
      titulo: t?.titulo ?? '', fecha: t?.fecha ?? null, descripcion: t?.descripcion ?? null, costo: t?.costo ?? null,
      moneda: t?.moneda ?? 'DOP', estado: t?.estado ?? 'completado', cotizacion_id: t?.cotizacion_id ?? null,
      solicitud_compra_id: t?.solicitud_compra_id ?? null,
    });
    this.drawer.set('trabajo');
  }
  nuevaFactura(f?: TecProveedorFactura) {
    this.editandoId.set(f?.id ?? null);
    this.archivoPendiente.set(null);
    this.formFactura.reset({
      numero: f?.numero ?? '', fecha: f?.fecha ?? null, monto: f?.monto ?? null, itbis: f?.itbis ?? null,
      moneda: f?.moneda ?? 'DOP', estado: f?.estado ?? 'pendiente', fecha_pago: f?.fecha_pago ?? null,
      trabajo_id: f?.trabajo_id ?? null, cotizacion_id: f?.cotizacion_id ?? null,
      solicitud_compra_id: f?.solicitud_compra_id ?? null, notas: f?.notas ?? null,
    });
    this.drawer.set('factura');
  }
  cerrarDrawer() {
    this.drawer.set(null);
    this.editandoId.set(null);
  }

  onArchivoAdd(files: File[]) {
    this.archivoPendiente.set(files[0] ?? null);
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  private async ejecutar(accion: string, fn: () => Promise<void>, ok: string) {
    this.guardando.set(true);
    try {
      await fn();
      this.toast.success(this.i18n.t(ok));
      this.cerrarDrawer();
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'el proveedor', accion }).mensajeUsuario);
    } finally {
      this.guardando.set(false);
    }
  }

  async guardarProveedor() {
    const p = this.proveedor();
    const v = this.formProveedor.getRawValue();
    if (!p || !v.nombre.trim()) {
      this.toast.error(this.i18n.t('El nombre es obligatorio'));
      return;
    }
    const val = v.valoracion;
    if (val !== null && (val < 1 || val > 5)) {
      this.toast.error(this.i18n.t('La valoración va de 1 a 5'));
      return;
    }
    await this.ejecutar('guardar el proveedor', () => this.svc.actualizarProveedor(p.id, {
      nombre: v.nombre.trim(),
      nombre_comercial: v.nombre_comercial?.trim() || null,
      rnc: v.rnc?.trim() || null,
      categoria_id: v.categoria_id || null,
      servicio: v.servicio?.trim() || null,
      etiquetas: v.etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
      direccion: v.direccion?.trim() || null,
      ciudad: v.ciudad?.trim() || null,
      web: v.web?.trim() || null,
      estado: v.estado,
      valoracion: val,
    }), 'Proveedor actualizado');
  }

  async guardarNotas() {
    const p = this.proveedor();
    if (!p) return;
    await this.ejecutar('guardar las notas', () => this.svc.actualizarProveedor(p.id, { notas: this.notasForm.value.trim() || null }), 'Notas guardadas');
  }

  async guardarContacto() {
    const p = this.proveedor();
    const v = this.formContacto.getRawValue();
    if (!p || !v.nombre.trim()) {
      this.toast.error(this.i18n.t('El nombre es obligatorio'));
      return;
    }
    await this.ejecutar('guardar el contacto', () => this.svc.guardarContacto(p.id, {
      nombre: v.nombre.trim(), cargo: v.cargo?.trim() || null, telefono: v.telefono?.trim() || null,
      whatsapp: v.whatsapp?.trim() || null, correo: v.correo?.trim() || null, principal: v.principal,
      notas: v.notas?.trim() || null,
    }, this.editandoId() ?? undefined), 'Contacto guardado');
  }

  async guardarTrabajo() {
    const p = this.proveedor();
    const v = this.formTrabajo.getRawValue();
    if (!p || !v.titulo.trim()) {
      this.toast.error(this.i18n.t('El título es obligatorio'));
      return;
    }
    if (v.costo !== null && v.costo < 0) {
      this.toast.error(this.i18n.t('El costo no puede ser negativo'));
      return;
    }
    await this.ejecutar('guardar el trabajo', () => this.svc.guardarTrabajo(p.id, {
      titulo: v.titulo.trim(), fecha: v.fecha, descripcion: v.descripcion?.trim() || null, costo: v.costo,
      moneda: v.moneda, estado: v.estado, cotizacion_id: v.cotizacion_id || null,
      solicitud_compra_id: v.solicitud_compra_id || null, equipo_id: null,
    }, this.editandoId() ?? undefined), 'Trabajo guardado');
  }

  async guardarFactura() {
    const p = this.proveedor();
    const v = this.formFactura.getRawValue();
    if (!p || !v.numero.trim()) {
      this.toast.error(this.i18n.t('El número de factura es obligatorio'));
      return;
    }
    if ((v.monto !== null && v.monto < 0) || (v.itbis !== null && v.itbis < 0)) {
      this.toast.error(this.i18n.t('Los montos no pueden ser negativos'));
      return;
    }
    await this.ejecutar('guardar la factura', () => this.svc.guardarFactura(p.id, {
      numero: v.numero.trim(), fecha: v.fecha, monto: v.monto, itbis: v.itbis, moneda: v.moneda, estado: v.estado,
      fecha_pago: v.estado === 'pagada' ? v.fecha_pago : null, trabajo_id: v.trabajo_id || null,
      cotizacion_id: v.cotizacion_id || null, solicitud_compra_id: v.solicitud_compra_id || null,
      notas: v.notas?.trim() || null,
    }, this.archivoPendiente(), this.editandoId() ?? undefined), 'Factura guardada');
  }

  async eliminar(tipo: 'contacto' | 'trabajo' | 'factura', id: string) {
    if (!window.confirm(this.i18n.t('¿Eliminar este registro? No se puede deshacer.'))) return;
    try {
      if (tipo === 'contacto') await this.svc.eliminarContacto(id);
      else if (tipo === 'trabajo') await this.svc.eliminarTrabajo(id);
      else await this.svc.eliminarFactura(id);
      this.toast.success(this.i18n.t('Eliminado'));
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo eliminar'), presentarError(e, { pantalla: 'el proveedor', accion: 'eliminar el registro' }).mensajeUsuario);
    }
  }

  async abrirFactura(f: TecProveedorFactura) {
    if (!f.archivo_path) return;
    try {
      window.open(await this.svc.getArchivoUrl(f.archivo_path), '_blank', 'noopener');
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo abrir el archivo'), presentarError(e, { pantalla: 'la factura', accion: 'abrir el archivo' }).mensajeUsuario);
    }
  }

  async desvincular(v: { cotizacionId?: string; solicitudCompraId?: string }) {
    try {
      await this.svc.desvincular(v);
      this.toast.success(this.i18n.t('Desvinculado'));
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo desvincular'), presentarError(e, { pantalla: 'el proveedor', accion: 'desvincular' }).mensajeUsuario);
    }
  }
}
