import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  SolicitudesMovimientoService,
  SolicitudMovimiento,
  ChoferCercano,
  MovimientoItem,
} from '../../../shared/services/solicitudes-movimiento.service';
import { ProyectosService } from '../../../shared/services/proyectos.service';
import { VehiculosService } from '../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../shared/services/conductores.service';
import { ArticulosService } from '../../../shared/services/articulos.service';
import { BodegasService } from '../../../shared/services/bodegas.service';
import { DatosPruebaViewService } from '../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Proyecto } from '../../../shared/models/proyecto.model';
import { Vehiculo } from '../../../shared/models/vehiculo.model';
import { Conductor } from '../../../shared/models/conductor.model';
import { Articulo } from '../../../shared/models/articulo.model';
import { Bodega } from '../../../shared/models/bodega.model';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../shared/ui/articulo-picker/articulo-picker';

const ROLES_REFERENTE = ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica', 'coord_compras', 'guarda_almacen'];

/**
 * AY11 — Solicitud de movimiento. El ingeniero solicita mover material/equipo; los
 * referentes (jefe de flota, logística, guarda-almacén, coord. compras, gerencia)
 * ven todas, crean la ruta y la asignan a un chofer. Sin gate de módulo: la RLS y
 * es_referente_movimiento gobiernan qué ve/gestiona cada quien.
 */
@Component({
  selector: 'app-solicitudes-movimiento',
  imports: [ReactiveFormsModule, DatePipe, FormDrawer, Skeleton, ArticuloPicker],
  templateUrl: './solicitudes-movimiento.html',
  styleUrl: './solicitudes-movimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesMovimiento implements OnInit {
  private svc = inject(SolicitudesMovimientoService);
  private proyectosSvc = inject(ProyectosService);
  private vehiculosSvc = inject(VehiculosService);
  private conductoresSvc = inject(ConductoresService);
  private articulosSvc = inject(ArticulosService);
  private bodegasSvc = inject(BodegasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPruebaView = inject(DatosPruebaViewService);

  esReferente = computed(() => ROLES_REFERENTE.some((r) => this.userService.hasRole(r)));

  solicitudes = signal<SolicitudMovimiento[]>([]);
  proyectos = signal<Proyecto[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  // CF5 — catálogo de artículos + almacenes para los renglones y selectores.
  articulos = signal<Articulo[]>([]);
  bodegas = signal<Bodega[]>([]);
  loading = signal(true);

  // CF5 — almacenes con el Central primero (luego almacenes de obra por nombre).
  bodegasOrden = computed(() =>
    [...this.datosPruebaView.visibles(this.bodegas())].sort((a, b) =>
      (b.es_central ? 1 : 0) - (a.es_central ? 1 : 0) || a.nombre.localeCompare(b.nombre),
    ),
  );
  articulosActivos = computed(() => this.articulos().filter((a) => a.activo));

  // CF5 — renglones de lo que se mueve (catálogo o "no catalogado").
  renglones = signal<MovimientoItem[]>([{ articulo_id: null, descripcion: '', cantidad: null, unidad: null }]);
  // CF5 — tipos de origen/destino como signals (para que el selector condicional reaccione en OnPush).
  origenTipo = signal('almacen');
  destinoTipo = signal('obra');

  // AT14 — los selectores no ofrecen datos de prueba a no-admins.
  proyectosVisibles = computed(() => this.datosPruebaView.visibles(this.proyectos()));
  vehiculosVisibles = computed(() => this.datosPruebaView.visibles(this.vehiculos()));
  conductoresVisibles = computed(() => this.datosPruebaView.visibles(this.conductores()));

  // Filtros
  fEstado = signal<string>('');
  fPrioridad = signal<string>('');
  fProyecto = signal<string>('');

  // Crear
  crearOpen = signal(false);
  saving = signal(false);
  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null),
    tipo_carga: new FormControl('materiales'),
    origen_tipo: new FormControl('almacen'),
    origen_texto: new FormControl<string | null>(null),
    origen_bodega_id: new FormControl<string | null>(null),
    origen_proyecto_id: new FormControl<string | null>(null),
    destino_tipo: new FormControl('obra'),
    destino_texto: new FormControl<string | null>(null),
    destino_bodega_id: new FormControl<string | null>(null),
    prioridad: new FormControl<'baja' | 'media' | 'alta' | 'urgente'>('media'),
    fecha_requerimiento: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

  // CF5 — edición de renglones.
  agregarRenglon() {
    this.renglones.update((r) => [...r, { articulo_id: null, descripcion: '', cantidad: null, unidad: null }]);
  }
  quitarRenglon(i: number) {
    this.renglones.update((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));
  }
  setRenglonArticulo(i: number, sel: ArticuloPickerSelection) {
    const art = sel.articuloId ? this.articulos().find((a) => a.id === sel.articuloId) : null;
    this.renglones.update((r) => r.map((it, idx) => idx === i
      ? { ...it, articulo_id: sel.esOtro ? null : sel.articuloId,
          descripcion: art ? art.nombre : it.descripcion,
          unidad: art ? art.unidad : it.unidad }
      : it));
  }
  setRenglonCampo(i: number, campo: 'descripcion' | 'unidad', val: string) {
    this.renglones.update((r) => r.map((it, idx) => idx === i ? { ...it, [campo]: val } : it));
  }
  setRenglonCantidad(i: number, val: string) {
    const n = val === '' ? null : Number(val);
    this.renglones.update((r) => r.map((it, idx) => idx === i ? { ...it, cantidad: Number.isFinite(n as number) ? n : null } : it));
  }

  // Planificar
  planOpen = signal(false);
  planActiva = signal<SolicitudMovimiento | null>(null);
  planVehiculo = signal<string | null>(null);
  planConductor = signal<string | null>(null);
  planFecha = signal<string | null>(null);
  planSaving = signal(false);
  choferesCerca = signal<ChoferCercano[]>([]);
  buscandoChoferes = signal(false);

  filtradas = computed(() => {
    const e = this.fEstado();
    const p = this.fPrioridad();
    const pr = this.fProyecto();
    return this.solicitudes().filter(
      (s) => (!e || s.estado === e) && (!p || s.prioridad === p) && (!pr || s.proyecto_id === pr),
    );
  });

  async ngOnInit() {
    await this.cargar();
    // Catálogos para los formularios (best-effort; no bloquean la lista).
    try {
      const [proys, vehs, conds, arts, bods] = await Promise.all([
        this.proyectosSvc.getAll(),
        this.vehiculosSvc.getAll(),
        this.conductoresSvc.getAll(),
        this.articulosSvc.getAll(),
        this.bodegasSvc.getAll(),
      ]);
      this.proyectos.set(proys);
      this.vehiculos.set(vehs.filter((v) => v.activo && v.estado !== 'baja'));
      this.conductores.set(conds.filter((c) => c.activo));
      this.articulos.set(arts);
      this.bodegas.set(bods);
    } catch {
      /* catálogos opcionales */
    }
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.solicitudes.set(await this.svc.listar());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Crear ────────────────────────────────────────────────
  abrirCrear() {
    this.form.reset({ tipo_carga: 'materiales', origen_tipo: 'almacen', destino_tipo: 'obra', prioridad: 'media' });
    this.renglones.set([{ articulo_id: null, descripcion: '', cantidad: null, unidad: null }]);
    this.origenTipo.set('almacen');
    this.destinoTipo.set('obra');
    this.crearOpen.set(true);
  }

  // CF5 — renglones válidos (con artículo o con descripción escrita).
  renglonesValidos = computed(() =>
    this.renglones().filter((r) => r.articulo_id || (r.descripcion ?? '').trim()),
  );

  async guardarCrear() {
    this.form.markAllAsTouched();
    const items = this.renglonesValidos();
    if (this.form.invalid || this.saving()) return;
    if (!items.length) {
      this.toast.error('Agrega al menos un renglón de lo que se va a mover.');
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.value;
      const ot = v.origen_tipo ?? 'almacen';
      const dt = v.destino_tipo ?? 'obra';
      await this.svc.crearV2({
        proyecto_id: v.proyecto_id ?? null,
        items: items.map((r) => ({
          articulo_id: r.articulo_id,
          descripcion: (r.descripcion ?? '').trim(),
          cantidad: r.cantidad,
          unidad: (r.unidad ?? '')?.trim() || null,
        })),
        tipo_carga: v.tipo_carga ?? 'materiales',
        origen_tipo: ot,
        origen_texto: ot === 'proveedor' || ot === 'otro' ? (v.origen_texto?.trim() || null) : null,
        origen_bodega_id: ot === 'almacen' ? (v.origen_bodega_id ?? null) : null,
        origen_proyecto_id: ot === 'obra' ? (v.origen_proyecto_id ?? null) : null,
        destino_tipo: dt,
        destino_texto: dt === 'proveedor' || dt === 'otro' ? (v.destino_texto?.trim() || null) : null,
        destino_bodega_id: dt === 'almacen' ? (v.destino_bodega_id ?? null) : null,
        destino_proyecto_id: dt === 'obra' ? (v.proyecto_id ?? null) : null,
        prioridad: v.prioridad ?? 'media',
        fecha_requerimiento: v.fecha_requerimiento || null,
        notas: v.notas?.trim() || null,
      });
      this.toast.success('Solicitud creada', 'El departamento de transporte fue notificado.');
      this.crearOpen.set(false);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la solicitud.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Cancelar ─────────────────────────────────────────────
  puedeCancelar(s: SolicitudMovimiento): boolean {
    if (s.estado === 'completada' || s.estado === 'cancelada') return false;
    if (this.esReferente()) return true;
    return s.estado === 'pendiente'; // el ingeniero solo mientras esté pendiente
  }

  async cancelar(s: SolicitudMovimiento) {
    if (!confirm(`¿Cancelar la solicitud "${s.que_se_mueve}"?`)) return;
    try {
      await this.svc.cancelar(s.id);
      this.toast.success('Solicitud cancelada');
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cancelar.');
    }
  }

  // ── Completar (referente) ────────────────────────────────
  async completar(s: SolicitudMovimiento) {
    try {
      await this.svc.completar(s.id);
      this.toast.success('Solicitud completada');
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar.');
    }
  }

  // ── Planificar con ruta (referente) ──────────────────────
  abrirPlanificar(s: SolicitudMovimiento) {
    this.planActiva.set(s);
    this.planVehiculo.set(null);
    this.planConductor.set(null);
    this.planFecha.set(null);
    this.choferesCerca.set([]);
    this.planOpen.set(true);
    if (s.proyecto_id) void this.sugerirChoferes(s.proyecto_id);
  }

  private async sugerirChoferes(proyectoId: string) {
    this.buscandoChoferes.set(true);
    try {
      this.choferesCerca.set(await this.svc.choferesCercanosDeProyecto(proyectoId));
    } catch {
      this.choferesCerca.set([]);
    } finally {
      this.buscandoChoferes.set(false);
    }
  }

  /** Selecciona el chofer sugerido en el form de planificación (por su usuario). */
  usarChoferSugerido(c: ChoferCercano) {
    const cond = this.conductores().find((x) => x.usuario_id === c.usuario_id);
    if (cond) this.planConductor.set(cond.id);
    else this.toast.info('Chofer sin ficha', 'Ese usuario no tiene ficha de conductor; elígelo manualmente.');
  }

  async guardarPlanificar() {
    const s = this.planActiva();
    if (!s || this.planSaving()) return;
    if (!this.planVehiculo() || !this.planConductor()) {
      this.toast.error('Faltan datos', 'Elige vehículo y chofer.');
      return;
    }
    this.planSaving.set(true);
    try {
      await this.svc.planificarConRuta(s.id, this.planVehiculo()!, this.planConductor()!, this.planFecha() || undefined);
      this.toast.success('Ruta creada', 'La solicitud quedó planificada y el chofer fue notificado.');
      this.planOpen.set(false);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo planificar.');
    } finally {
      this.planSaving.set(false);
    }
  }

  // ── Helpers de UI ────────────────────────────────────────
  prioridadClase(p: string): string {
    switch (p) {
      case 'urgente': return 'prio prio--urgente';
      case 'alta': return 'prio prio--alta';
      case 'media': return 'prio prio--media';
      default: return 'prio prio--baja';
    }
  }

  estadoClase(e: string): string {
    switch (e) {
      case 'pendiente': return 'est est--pendiente';
      case 'planificada': return 'est est--planificada';
      case 'en_curso': return 'est est--curso';
      case 'completada': return 'est est--completada';
      default: return 'est est--cancelada';
    }
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente': return 'Pendiente';
      case 'planificada': return 'Planificada';
      case 'en_curso': return 'En curso';
      case 'completada': return 'Completada';
      default: return 'Cancelada';
    }
  }

  /** Semáforo por fecha de requerimiento (solo si sigue abierta). */
  semaforoClase(s: SolicitudMovimiento): string {
    if (s.estado === 'completada' || s.estado === 'cancelada') return '';
    const d = s.dias_para_requerimiento;
    if (d == null) return '';
    if (d < 0) return 'sem sem--vencida';
    if (d <= 1) return 'sem sem--hoy';
    if (d <= 3) return 'sem sem--pronto';
    return 'sem sem--ok';
  }
}
