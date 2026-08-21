import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  SolicitudesMovimientoService,
  SolicitudMovimiento,
  ChoferCercano,
} from '../../../shared/services/solicitudes-movimiento.service';
import { ProyectosService } from '../../../shared/services/proyectos.service';
import { VehiculosService } from '../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../shared/services/conductores.service';
import { DatosPruebaViewService } from '../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Proyecto } from '../../../shared/models/proyecto.model';
import { Vehiculo } from '../../../shared/models/vehiculo.model';
import { Conductor } from '../../../shared/models/conductor.model';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';

const ROLES_REFERENTE = ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica', 'coord_compras', 'guarda_almacen'];

/**
 * AY11 — Solicitud de movimiento. El ingeniero solicita mover material/equipo; los
 * referentes (jefe de flota, logística, guarda-almacén, coord. compras, gerencia)
 * ven todas, crean la ruta y la asignan a un chofer. Sin gate de módulo: la RLS y
 * es_referente_movimiento gobiernan qué ve/gestiona cada quien.
 */
@Component({
  selector: 'app-solicitudes-movimiento',
  imports: [ReactiveFormsModule, DatePipe, FormDrawer, Skeleton],
  templateUrl: './solicitudes-movimiento.html',
  styleUrl: './solicitudes-movimiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesMovimiento implements OnInit {
  private svc = inject(SolicitudesMovimientoService);
  private proyectosSvc = inject(ProyectosService);
  private vehiculosSvc = inject(VehiculosService);
  private conductoresSvc = inject(ConductoresService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private datosPruebaView = inject(DatosPruebaViewService);

  esReferente = computed(() => ROLES_REFERENTE.some((r) => this.userService.hasRole(r)));

  solicitudes = signal<SolicitudMovimiento[]>([]);
  proyectos = signal<Proyecto[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  loading = signal(true);

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
    que_se_mueve: new FormControl('', [Validators.required]),
    tipo_carga: new FormControl('materiales'),
    origen_tipo: new FormControl('almacen'),
    origen_texto: new FormControl<string | null>(null),
    destino_tipo: new FormControl('obra'),
    destino_texto: new FormControl<string | null>(null),
    prioridad: new FormControl<'baja' | 'media' | 'alta' | 'urgente'>('media'),
    fecha_requerimiento: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
  });

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
      const [proys, vehs, conds] = await Promise.all([
        this.proyectosSvc.getAll(),
        this.vehiculosSvc.getAll(),
        this.conductoresSvc.getAll(),
      ]);
      this.proyectos.set(proys);
      this.vehiculos.set(vehs.filter((v) => v.activo && v.estado !== 'baja'));
      this.conductores.set(conds.filter((c) => c.activo));
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
    this.crearOpen.set(true);
  }

  async guardarCrear() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.form.value;
      await this.svc.crear({
        proyecto_id: v.proyecto_id ?? null,
        que_se_mueve: (v.que_se_mueve ?? '').trim(),
        tipo_carga: v.tipo_carga ?? 'materiales',
        origen_tipo: v.origen_tipo ?? 'almacen',
        origen_texto: v.origen_texto?.trim() || null,
        destino_tipo: v.destino_tipo ?? 'obra',
        destino_texto: v.destino_texto?.trim() || null,
        destino_proyecto_id: v.destino_tipo === 'obra' ? (v.proyecto_id ?? null) : null,
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
