import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TecProveedoresService, enlaceCorreo, enlaceLlamar, enlaceWhatsapp } from '../../../../shared/services/tec-proveedores.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import {
  TecProveedorBusqueda,
  TecProveedorCategoria,
  TecProveedorFormData,
  TecProveedorPorRevisar,
} from '../../../../shared/models/tec-proveedor.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { presentarError } from '../../../../shared/utils/friendly-error.util';

const SUBMODULO = 'tecnologia.proveedores';

/** EA1 — lista de proveedores de tecnología con buscador único («cerradura», «puertas», un contacto…). */
@Component({
  selector: 'app-tec-proveedores',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Icon, TranslatePipe],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecProveedores implements OnInit {
  private svc = inject(TecProveedoresService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private user = inject(UserService);
  protected i18n = inject(I18nService);

  // Compras y admin solo ven (el servidor es la fuente; esto solo evita pintar botones que se van a negar — BH1).
  puedeOperar = computed(() => this.user.puedeOperarSubmodulo(SUBMODULO));

  resultados = signal<TecProveedorBusqueda[]>([]);
  categorias = signal<TecProveedorCategoria[]>([]);
  porRevisar = signal<TecProveedorPorRevisar[]>([]);
  loading = signal(true);
  error = signal('');

  query = signal('');
  incluirInactivos = signal(false);
  verPorRevisar = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;

  // ── Alta ────────────────────────────────────────────────────────────────
  createOpen = signal(false);
  guardando = signal(false);
  form = new FormGroup({
    nombre: new FormControl<string>('', { nonNullable: true }),
    nombre_comercial: new FormControl<string | null>(null),
    rnc: new FormControl<string | null>(null),
    categoria_id: new FormControl<string | null>(null),
    servicio: new FormControl<string | null>(null),
    etiquetas: new FormControl<string>('', { nonNullable: true }),
    ciudad: new FormControl<string | null>(null),
    web: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  enlaceLlamar = enlaceLlamar;
  enlaceWhatsapp = enlaceWhatsapp;
  enlaceCorreo = enlaceCorreo;

  async ngOnInit() {
    void this.cargarCategorias();
    await this.buscar();
  }

  private async cargarCategorias() {
    try {
      this.categorias.set(await this.svc.getCategorias());
    } catch { /* best-effort: el filtro simplemente no muestra categorías */ }
  }

  onQuery(v: string) {
    this.query.set(v);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.buscar(), 250);
  }

  alternarInactivos() {
    this.incluirInactivos.update((v) => !v);
    void this.buscar();
  }

  async buscar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.resultados.set(await this.svc.buscar(this.query(), this.incluirInactivos()));
    } catch (e: unknown) {
      this.error.set(presentarError(e, { pantalla: 'los proveedores de tecnología' }).mensajeUsuario);
    } finally {
      this.loading.set(false);
    }
  }

  async alternarPorRevisar() {
    const abrir = !this.verPorRevisar();
    this.verPorRevisar.set(abrir);
    if (!abrir) return;
    try {
      this.porRevisar.set(await this.svc.porRevisar());
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo cargar'), presentarError(e, { pantalla: 'los proveedores por revisar' }).mensajeUsuario);
    }
  }

  abrir(id: string) {
    void this.router.navigate(['/tecnologia/proveedores', id]);
  }

  etiquetaCoincidencia(c: TecProveedorBusqueda['coincidencia']): string {
    switch (c) {
      case 'servicio': return 'Servicio o etiqueta';
      case 'contacto': return 'Contacto';
      case 'trabajo': return 'Trabajo realizado';
      case 'cotizacion': return 'Cotización';
      case 'varios': return 'Varios campos';
      default: return '';
    }
  }

  etiquetaMotivo(m: TecProveedorPorRevisar['motivo']): string {
    switch (m) {
      case 'varios_proveedores': return 'Parece tener varios proveedores';
      case 'muy_corto': return 'Nombre muy corto';
      case 'solo_numeros': return 'Solo números';
      case 'similar_a_otro': return 'Parecido a otro proveedor';
      case 'sin_vincular': return 'Existe el proveedor, falta vincular';
      case 'vacio': return 'Vacío';
      default: return 'Sin coincidencia';
    }
  }

  // ── Alta de proveedor ────────────────────────────────────────────────────
  abrirCrear(nombre = '') {
    this.form.reset({ nombre, nombre_comercial: null, rnc: null, categoria_id: null, servicio: null, etiquetas: '', ciudad: null, web: null, notas: null });
    this.createOpen.set(true);
  }
  cerrarCrear() {
    this.createOpen.set(false);
  }

  async guardar() {
    const v = this.form.getRawValue();
    if (!v.nombre.trim()) {
      this.toast.error(this.i18n.t('El nombre es obligatorio'));
      return;
    }
    const payload: TecProveedorFormData = {
      nombre: v.nombre.trim(),
      nombre_comercial: v.nombre_comercial?.trim() || null,
      rnc: v.rnc?.trim() || null,
      categoria_id: v.categoria_id || null,
      servicio: v.servicio?.trim() || null,
      etiquetas: v.etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
      direccion: null,
      ciudad: v.ciudad?.trim() || null,
      web: v.web?.trim() || null,
      notas: v.notas?.trim() || null,
      estado: 'activo',
      valoracion: null,
    };
    this.guardando.set(true);
    try {
      const id = await this.svc.crearProveedor(payload);
      this.toast.success(this.i18n.t('Proveedor creado'));
      this.createOpen.set(false);
      this.abrir(id);
    } catch (e: unknown) {
      this.toast.error(this.i18n.t('No se pudo guardar'), presentarError(e, { pantalla: 'el proveedor', accion: 'guardar el proveedor' }).mensajeUsuario);
    } finally {
      this.guardando.set(false);
    }
  }

  trackId = (_: number, r: TecProveedorBusqueda) => r.id;
}
