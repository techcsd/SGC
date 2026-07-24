import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { VehiculosService } from '../../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../../shared/services/conductores.service';
import { ChecklistsVehiculoService } from '../../../../../shared/services/checklists-vehiculo.service';
import { MantenimientosService } from '../../../../../shared/services/mantenimientos.service';
import { CombustibleService } from '../../../../../shared/services/combustible.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { NotificacionesService } from '../../../../../shared/services/notificaciones.service';
import { UserService } from '../../../../core/services/user.service';
import { FlotaIncidenciasService } from '../../../../../shared/services/flota-incidencias.service';
import { MultaDetalle } from '../../../../../shared/components/multa-detalle/multa-detalle';
import {
  VehiculoAccidente,
  VehiculoDano,
  ConductorMulta,
  MULTA_ESTADOS,
  ACCIDENTE_FASES,
  DANO_ORIGENES,
  AccidenteFase,
  DanoOrigen,
} from '../../../../../shared/models/flota-incidencias.model';
import { FlotaConfigService } from '../../../../../shared/services/flota-config.service';
import {
  Vehiculo,
  VEHICULO_ESTADO_BADGE,
  VEHICULO_ESTADOS,
  VEHICULO_TIPOS,
  VehiculoTipo,
  estadoVencimiento,
  VENCIMIENTO_LABEL,
  VENCIMIENTO_BADGE,
  proximoMantenimientoKm,
  kmFaltanMantenimiento,
  mantenimientoPorRevisar,
} from '../../../../../shared/models/vehiculo.model';
import { VehiculoAsignacion, VehiculoStats } from '../../../../../shared/models/vehiculo-asignacion.model';
import {
  ChecklistVehiculo,
  ChecklistResultado,
  RESULTADO_META,
} from '../../../../../shared/models/flota-checklist.model';
import { Mantenimiento, MANT_TIPOS, MANT_ESTADOS } from '../../../../../shared/models/mantenimiento.model';
import { RegistroCombustible } from '../../../../../shared/models/combustible.model';
import { FormDrawer } from '../../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../../shared/components/skeleton/skeleton';
import { DocumentosFlota } from '../../../../../shared/components/documentos-flota/documentos-flota';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../../shared/utils/fecha.util';

const HISTORIAL_LIMITE = 15;

@Component({
  selector: 'app-vehiculo-detalle',
  imports: [DecimalPipe, RouterLink, ReactiveFormsModule, FormDrawer, Skeleton, DocumentosFlota, MultaDetalle],
  templateUrl: './vehiculo-detalle.html',
  styleUrl: './vehiculo-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VehiculoDetalle implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private checklistsService = inject(ChecklistsVehiculoService);
  private mantenimientosService = inject(MantenimientosService);
  private combustibleService = inject(CombustibleService);
  private toast = inject(ToastService);
  private notificaciones = inject(NotificacionesService);
  private userService = inject(UserService);
  private incidencias = inject(FlotaIncidenciasService);
  private flotaConfig = inject(FlotaConfigService);

  readonly esElevado = this.userService.esFlotaElevado;
  readonly ACCIDENTE_FASES = ACCIDENTE_FASES;
  readonly DANO_ORIGENES = DANO_ORIGENES;
  readonly MULTA_ESTADOS = MULTA_ESTADOS;

  readonly vehiculoId = this.route.snapshot.paramMap.get('id') ?? '';
  // tipo de documento a auto-abrir cuando se llega desde un aviso (?doc=seguro)
  readonly docAuto = this.route.snapshot.queryParamMap.get('doc');

  // ── Helpers expuestos al template ──
  estadoBadge = VEHICULO_ESTADO_BADGE;
  vencLabel = VENCIMIENTO_LABEL;
  vencBadge = VENCIMIENTO_BADGE;
  estadoVenc = estadoVencimiento;
  kmFaltan = kmFaltanMantenimiento;
  proxKm = proximoMantenimientoKm;

  loading = signal(true);
  error = signal('');

  vehiculo = signal<Vehiculo | null>(null);
  stats = signal<VehiculoStats | null>(null);
  asignaciones = signal<VehiculoAsignacion[]>([]);
  checklists = signal<ChecklistVehiculo[]>([]);
  mantenimientos = signal<Mantenimiento[]>([]);
  combustibles = signal<RegistroCombustible[]>([]);
  fotoUrl = signal<string | null>(null);

  reactivando = signal(false);
  mostrarHistorialAsig = signal(false);

  // ── Drawer "Asignar persona" ──
  drawerOpen = signal(false);
  guardando = signal(false);
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  asignarForm = this.fb.group({
    usuario_id: [null as string | null, Validators.required],
    notas: [''],
  });

  // ── Derivados ──
  asignacionesActivas = computed(() => this.asignaciones().filter((a) => a.activa));
  asignacionesHistoricas = computed(() => this.asignaciones().filter((a) => !a.activa));

  kmFaltanMant = computed(() => {
    const v = this.vehiculo();
    return v ? kmFaltanMantenimiento(v) : null;
  });

  // Y9 3.3 — dato de mantenimiento incoherente (km último > odómetro): no se
  // muestra "faltan X km"; se pide revisar. El servidor ya avisó a flota.
  mantPorRevisar = computed(() => {
    const v = this.vehiculo();
    return v ? mantenimientoPorRevisar(v) : false;
  });

  // ── U11-web — alerta de mantenimiento visible en el perfil ──
  // 'vencido' si km_actual ≥ próximo (kmFaltan ≤ 0); 'pre_cita' si está cerca
  // (dentro del umbral de pre-cita configurable). Reusa la regla del server.
  alertaMant = computed<{ estado: 'vencido' | 'pre_cita'; km: number } | null>(() => {
    const faltan = this.kmFaltanMant();
    if (faltan == null) return null;
    if (faltan <= 0) return { estado: 'vencido', km: -faltan };
    if (faltan <= this.flotaConfig.umbralPrecitaKm()) return { estado: 'pre_cita', km: faltan };
    return null;
  });

  // ── U11-web — último nivel de combustible registrado (cabecera más reciente) ──
  ultimoNivelCombustible = computed<string | null>(() => {
    // Los checklists llegan ordenados por fecha desc; toma el primero con nivel.
    for (const c of this.checklists()) {
      if (c.nivel_combustible) return c.nivel_combustible;
    }
    return null;
  });

  checklistsRecientes = computed(() => this.checklists().slice(0, HISTORIAL_LIMITE));
  mantenimientosRecientes = computed(() => this.mantenimientos().slice(0, HISTORIAL_LIMITE));
  combustiblesRecientes = computed(() => this.combustibles().slice(0, HISTORIAL_LIMITE));

  // ── S20 — rendimiento esperado vs real ──
  rendimientoReal = computed<number | null>(() => this.stats()?.rendimiento_promedio ?? null);
  rendimientoEsperado = computed<number | null>(() => this.vehiculo()?.rendimiento_esperado_km_gal ?? null);
  rendimientoBajo = computed<boolean>(() => {
    const esp = this.rendimientoEsperado();
    const real = this.rendimientoReal();
    return esp != null && real != null && real < esp;
  });

  // ── S21 — motivo de "No disponible" por documento vencido ──
  motivoNoDisponible = computed<string | null>(() => {
    const v = this.vehiculo();
    if (!v || v.estado !== 'no_disponible') return null;
    const motivos: string[] = [];
    if (this.estadoVenc(v.vencimiento_matricula) === 'vencido') motivos.push('matrícula');
    if (this.estadoVenc(v.vencimiento_seguro) === 'vencido') motivos.push('seguro');
    return motivos.length ? motivos.join(' y ') : null;
  });

  // ── FASE 4 — accidentes / daños ──
  accidentes = signal<VehiculoAccidente[]>([]);
  danos = signal<VehiculoDano[]>([]);
  multas = signal<ConductorMulta[]>([]); // U11-web — multas del vehículo
  multaDetalle = signal<ConductorMulta | null>(null); // W5-web
  incMediaUrls = signal<Record<string, string>>({});
  accDrawer = signal(false);
  danoDrawer = signal(false);
  incGuardando = signal(false);
  private accFile: File | null = null;
  private danoFile: File | null = null;
  accForm = this.fb.group({
    fecha: [new Date().toISOString().slice(0, 10), Validators.required],
    fase: ['en_el_momento' as AccidenteFase, Validators.required],
    descripcion: [''],
    lesionados: [0, [Validators.min(0)]],
    tercero_involucrado: [''],
  });
  danoForm = this.fb.group({
    zona: [''],
    descripcion: [''],
    origen: ['desconocido' as DanoOrigen, Validators.required],
  });

  async ngOnInit() {
    if (!this.vehiculoId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const [vehiculo, stats, asignaciones, checklists, mantenimientos, combustibles] =
        await Promise.all([
          this.vehiculosService.getById(this.vehiculoId),
          this.vehiculosService.getStats(this.vehiculoId),
          this.vehiculosService.getAsignaciones(this.vehiculoId),
          this.checklistsService.getChecklists(),
          this.mantenimientosService.getAll(),
          this.combustibleService.getAll(),
        ]);

      this.vehiculo.set(vehiculo);
      this.stats.set(stats);
      this.asignaciones.set(asignaciones);
      this.checklists.set(checklists.filter((c) => c.vehiculo_id === this.vehiculoId));
      this.mantenimientos.set(mantenimientos.filter((m) => m.vehiculo_id === this.vehiculoId));
      this.combustibles.set(combustibles.filter((r) => r.vehiculo_id === this.vehiculoId));

      // FASE 4 — accidentes/daños (best-effort, no bloquea el perfil).
      this.cargarIncidencias();

      const primeraFoto = vehiculo?.fotos?.[0];
      if (primeraFoto) {
        this.fotoUrl.set(await this.vehiculosService.getFotoUrl(primeraFoto));
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el vehículo.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Labels ──
  tipoLabel(tipo: VehiculoTipo | string | null | undefined): string {
    return VEHICULO_TIPOS.find((t) => t.value === tipo)?.label ?? (tipo ?? '—');
  }
  estadoLabel(estado: string | null | undefined): string {
    return VEHICULO_ESTADOS.find((e) => e.value === estado)?.label ?? (estado ?? '—');
  }
  mantTipoLabel(tipo: string | null | undefined): string {
    return MANT_TIPOS.find((t) => t.value === tipo)?.label ?? (tipo ?? '—');
  }
  mantEstadoLabel(estado: string | null | undefined): string {
    return MANT_ESTADOS.find((e) => e.value === estado)?.label ?? (estado ?? '—');
  }
  mantEstadoBadge(estado: string | null | undefined): string {
    return estado === 'completado' ? 'success' : estado === 'en_proceso' ? 'warning' : 'neutral';
  }

  private resultadoDe(c: ChecklistVehiculo): ChecklistResultado {
    return c.resultado ?? (c.tiene_criticos ? 'bloqueado' : 'aprobado');
  }
  resultadoMeta(c: ChecklistVehiculo) {
    return RESULTADO_META[this.resultadoDe(c)];
  }

  /** Fecha/timestamp seguro para DR (evita el shift de new Date sobre YYYY-MM-DD). */
  fecha(v: string | null | undefined): string {
    if (!v) return '—';
    return v.length <= 10 ? formatFechaDisplay(v) : formatTimestampDisplay(v);
  }

  asigNombre(a: VehiculoAsignacion): string {
    return a.usuario?.nombre ?? a.conductor?.nombre ?? '—';
  }

  // ── Reactivar vehículo ──
  async reactivar() {
    const v = this.vehiculo();
    if (!v || this.reactivando()) return;
    this.reactivando.set(true);
    try {
      await this.vehiculosService.reactivar(v.id);
      this.vehiculo.update((x) => (x ? { ...x, estado: 'activo' } : x));
      this.notificaciones.refresh();
      this.toast.success('Vehículo reactivado', 'El vehículo volvió a estado activo.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo reactivar el vehículo.');
    } finally {
      this.reactivando.set(false);
    }
  }

  // ── Asignar persona (drawer) ──
  async openAsignar() {
    this.asignarForm.reset({ usuario_id: null, notas: '' });
    this.drawerOpen.set(true);
    if (this.usuarios().length === 0) {
      try {
        this.usuarios.set(await this.conductoresService.getUsuariosVinculables());
      } catch {
        /* el picker queda vacío si falla; no bloquea el drawer */
      }
    }
  }
  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async asignar() {
    if (this.guardando()) return;
    if (this.asignarForm.invalid) {
      this.asignarForm.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    const { usuario_id, notas } = this.asignarForm.getRawValue();
    try {
      await this.vehiculosService.crearAsignacion({
        vehiculo_id: this.vehiculoId,
        usuario_id: usuario_id,
        notas: notas?.trim() || null,
      });
      this.asignaciones.set(await this.vehiculosService.getAsignaciones(this.vehiculoId));
      this.drawerOpen.set(false);
      this.toast.success('Persona asignada', 'La asignación se registró correctamente.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo crear la asignación.');
    } finally {
      this.guardando.set(false);
    }
  }

  async retirar(a: VehiculoAsignacion) {
    if (!confirm(`¿Retirar la asignación de ${this.asigNombre(a)}?`)) return;
    try {
      await this.vehiculosService.retirarAsignacion(a.id);
      this.asignaciones.set(await this.vehiculosService.getAsignaciones(this.vehiculoId));
      this.toast.success('Asignación retirada', 'Se marcó como inactiva.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo retirar la asignación.');
    }
  }

  toggleHistorialAsig() {
    this.mostrarHistorialAsig.update((v) => !v);
  }

  // ── FASE 4 — accidentes / daños ──────────────────────────────
  private async cargarIncidencias() {
    try {
      const [acc, dan, mul] = await Promise.all([
        this.incidencias.accidentesPorVehiculo(this.vehiculoId),
        this.incidencias.danosPorVehiculo(this.vehiculoId),
        this.incidencias.multasPorVehiculo(this.vehiculoId),
      ]);
      this.accidentes.set(acc);
      this.danos.set(dan);
      this.multas.set(mul);
      // Resuelve URLs firmadas de actas AMET + fotos de daño + documentos de multa.
      const paths = [
        ...acc.map((a) => a.reporte_amet_path).filter(Boolean),
        ...dan.map((d) => d.foto_path).filter(Boolean),
        ...mul.map((m) => m.documento_path).filter(Boolean),
      ] as string[];
      const entries = await Promise.all(
        paths.map(async (p) => [p, await this.incidencias.signedUrl(p)] as const),
      );
      const map: Record<string, string> = {};
      for (const [p, url] of entries) if (url) map[p] = url;
      this.incMediaUrls.set(map);
    } catch {
      /* sin incidencias, no bloquea */
    }
  }

  incUrl(path: string | null | undefined): string | null {
    return path ? (this.incMediaUrls()[path] ?? null) : null;
  }
  faseLabel(f: string): string {
    return ACCIDENTE_FASES.find((x) => x.value === f)?.label ?? f;
  }
  origenLabel(o: string): string {
    return DANO_ORIGENES.find((x) => x.value === o)?.label ?? o;
  }
  multaEstadoMeta(estado: string) {
    return MULTA_ESTADOS.find((x) => x.value === estado) ?? { label: estado, badge: 'neutral' };
  }
  /** Accidentes con acta AMET (los que se muestran en el perfil del vehículo). */
  accidentesConActa = computed(() => this.accidentes().filter((a) => a.reporte_amet_path));

  openAccidente() {
    this.accForm.reset({ fecha: new Date().toISOString().slice(0, 10), fase: 'en_el_momento', descripcion: '', lesionados: 0, tercero_involucrado: '' });
    this.accFile = null;
    this.accDrawer.set(true);
  }
  onAccFile(e: Event) {
    this.accFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }
  async guardarAccidente() {
    if (this.incGuardando()) return;
    if (this.accForm.invalid) { this.accForm.markAllAsTouched(); return; }
    const uid = this.userService.profile()?.id;
    if (!uid) return;
    this.incGuardando.set(true);
    const v = this.accForm.getRawValue();
    try {
      await this.incidencias.crearAccidente(
        {
          vehiculo_id: this.vehiculoId,
          conductor_id: null,
          fecha: v.fecha!,
          fase: v.fase as AccidenteFase,
          descripcion: v.descripcion?.trim() || null,
          lesionados: v.lesionados ?? 0,
          tercero_involucrado: v.tercero_involucrado?.trim() || null,
        },
        uid,
        this.accFile,
      );
      this.accDrawer.set(false);
      await this.cargarIncidencias();
      this.toast.success('Accidente registrado');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo registrar el accidente.');
    } finally {
      this.incGuardando.set(false);
    }
  }

  openDano() {
    this.danoForm.reset({ zona: '', descripcion: '', origen: 'desconocido' });
    this.danoFile = null;
    this.danoDrawer.set(true);
  }
  onDanoFile(e: Event) {
    this.danoFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }
  async guardarDano() {
    if (this.incGuardando()) return;
    if (this.danoForm.invalid) { this.danoForm.markAllAsTouched(); return; }
    const uid = this.userService.profile()?.id;
    if (!uid) return;
    this.incGuardando.set(true);
    const v = this.danoForm.getRawValue();
    try {
      await this.incidencias.crearDano(
        {
          vehiculo_id: this.vehiculoId,
          zona: v.zona?.trim() || null,
          descripcion: v.descripcion?.trim() || null,
          origen: v.origen as DanoOrigen,
          accidente_id: null,
        },
        uid,
        this.danoFile,
      );
      this.danoDrawer.set(false);
      await this.cargarIncidencias();
      this.toast.success('Daño registrado');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo registrar el daño.');
    } finally {
      this.incGuardando.set(false);
    }
  }
}
