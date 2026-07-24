import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConductoresService } from '../../../../../shared/services/conductores.service';
import { ChecklistsVehiculoService } from '../../../../../shared/services/checklists-vehiculo.service';
import { CombustibleService } from '../../../../../shared/services/combustible.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { FlotaConfigService } from '../../../../../shared/services/flota-config.service';
import { RutasService } from '../../../../../shared/services/rutas.service';
import { SalidasService } from '../../../../../shared/services/salidas.service';
import { VehiculosService } from '../../../../../shared/services/vehiculos.service';
import { FlotaIncidenciasService } from '../../../../../shared/services/flota-incidencias.service';
import { MotivosMultaService, MotivoMulta } from '../../../../../shared/services/motivos-multa.service';
import { MultaDetalle } from '../../../../../shared/components/multa-detalle/multa-detalle';
import { UserService } from '../../../../core/services/user.service';
import { Conductor, LicenciaCategoria } from '../../../../../shared/models/conductor.model';
import { Ruta } from '../../../../../shared/models/ruta.model';
import { SalidaInventario, conduceNumero } from '../../../../../shared/models/salida.model';
import {
  VehiculoAccidente,
  ConductorMulta,
  MULTA_ESTADOS,
  MultaEstado,
} from '../../../../../shared/models/flota-incidencias.model';
import { FormDrawer } from '../../../../../shared/components/form-drawer/form-drawer';
import {
  ConductorStats,
  ESTADO_LICENCIA_LABEL,
  ESTADO_LICENCIA_BADGE,
} from '../../../../../shared/models/vehiculo-asignacion.model';
import {
  ChecklistVehiculo,
  ChecklistResultado,
  RESULTADO_META,
} from '../../../../../shared/models/flota-checklist.model';
import { RegistroCombustible } from '../../../../../shared/models/combustible.model';
import { Skeleton } from '../../../../../shared/components/skeleton/skeleton';
import { DocumentosFlota } from '../../../../../shared/components/documentos-flota/documentos-flota';
import { formatFechaDisplay, daysUntil, formatearDuracion } from '../../../../../shared/utils/fecha.util';
import { duracionRealMin } from '../../../../../shared/models/ruta.model';

const MAX_HIST = 15;

@Component({
  selector: 'app-conductor-detalle',
  imports: [DecimalPipe, RouterLink, ReactiveFormsModule, Skeleton, DocumentosFlota, FormDrawer, MultaDetalle],
  templateUrl: './conductor-detalle.html',
  styleUrl: './conductor-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConductorDetalle implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private conductoresService = inject(ConductoresService);
  private checklistsService = inject(ChecklistsVehiculoService);
  private combustibleService = inject(CombustibleService);
  private toast = inject(ToastService);
  private flotaConfig = inject(FlotaConfigService);
  private rutasService = inject(RutasService);
  private salidasService = inject(SalidasService);
  private vehiculosService = inject(VehiculosService);
  private incidencias = inject(FlotaIncidenciasService);
  private motivosMultaService = inject(MotivosMultaService);
  private userService = inject(UserService);

  readonly estadoLabel = ESTADO_LICENCIA_LABEL;
  readonly estadoBadge = ESTADO_LICENCIA_BADGE;
  readonly esElevado = this.userService.esFlotaElevado;
  readonly MULTA_ESTADOS = MULTA_ESTADOS;
  readonly conduceNumero = conduceNumero;
  readonly conductorId = this.route.snapshot.paramMap.get('id') ?? '';
  formatFecha = formatFechaDisplay;

  /** Y4 — duración de la ruta: real (TAP) si existe, si no el tiempo_real_min manual. */
  duracionRutaTxt(r: {
    iniciada_at?: string | null;
    finalizada_at?: string | null;
    tiempo_real_min: number | null;
  }): string {
    const min = duracionRealMin(r) ?? r.tiempo_real_min;
    return min != null ? formatearDuracion(min) : '—';
  }

  // tipo de documento a auto-abrir cuando se llega desde un aviso (?doc=licencia)
  readonly docAuto = this.route.snapshot.queryParamMap.get('doc');

  loading = signal(true);
  conductor = signal<Conductor | null>(null);
  stats = signal<ConductorStats | null>(null);
  checklists = signal<ChecklistVehiculo[]>([]);
  combustible = signal<RegistroCombustible[]>([]);

  // S32 — pre-usos vs reportes semanales (diferenciados por plantilla).
  private esSemanal(c: ChecklistVehiculo): boolean {
    return (c.plantilla?.nombre ?? '').toLowerCase().includes('semanal');
  }
  histPreuso = computed(() => this.checklists().filter((c) => !this.esSemanal(c)).slice(0, MAX_HIST));
  histSemanal = computed(() => this.checklists().filter((c) => this.esSemanal(c)).slice(0, MAX_HIST));

  // Últimas ~15 echadas de combustible del conductor (getAll viene por fecha desc).
  histCombustible = computed(() => this.combustible().slice(0, MAX_HIST));

  // S32 — rutas, conduces, entregas, accidentes y multas del conductor.
  rutas = signal<Ruta[]>([]);
  conduces = signal<SalidaInventario[]>([]);
  entregas = signal<{ id: string; tipo: string; estado: string; km: number; capturado_en: string; vehiculo?: { placa: string } }[]>([]);
  accidentes = signal<VehiculoAccidente[]>([]);
  multas = signal<ConductorMulta[]>([]);
  multaDocUrls = signal<Record<string, string>>({});
  multaDetalle = signal<ConductorMulta | null>(null); // W5-web

  histRutas = computed(() => this.rutas().slice(0, MAX_HIST));
  histConduces = computed(() => this.conduces().slice(0, MAX_HIST));
  histEntregas = computed(() => this.entregas().slice(0, MAX_HIST));

  // Multas — drawer de registro (elevados).
  multaDrawer = signal(false);
  multaGuardando = signal(false);
  private multaFile: File | null = null;
  // T9 — catálogo de motivos + "Otro".
  motivosMulta = signal<MotivoMulta[]>([]);
  multaForm = this.fb.group({
    fecha: [new Date().toISOString().slice(0, 10), Validators.required],
    motivo: ['', Validators.required],
    motivoOtro: [''],
    monto: [null as number | null, [Validators.min(0)]],
    estado: ['pendiente' as MultaEstado, Validators.required],
  });
  private motivoSel = toSignal(this.multaForm.controls.motivo.valueChanges, {
    initialValue: this.multaForm.controls.motivo.value,
  });
  multaMotivoEsOtro = computed(() => this.motivoSel() === 'Otro');

  licenciaVencida = computed(() => this.stats()?.estado_licencia === 'vencida');

  // C6 — vencimiento de licencia derivado de la fecha del conductor + umbral (~90d).
  licenciaExpirada = computed(() => {
    const v = this.conductor()?.licencia_vencimiento;
    return v ? daysUntil(v) < 0 : false;
  });
  licenciaPorVencer = computed(() => {
    const v = this.conductor()?.licencia_vencimiento;
    return v ? daysUntil(v) >= 0 && daysUntil(v) <= this.flotaConfig.umbralLicenciaDias() : false;
  });
  diasParaVencer = computed(() => {
    const v = this.conductor()?.licencia_vencimiento;
    return v ? daysUntil(v) : null;
  });

  // C1 — etiqueta de la categoría de licencia (cargada del catálogo).
  categoriaLabel = computed(() => {
    const codigo = this.conductor()?.licencia_tipo;
    if (!codigo) return '—';
    const cat = this.categorias().find((c) => c.codigo === codigo);
    return cat ? `${cat.codigo} — ${cat.nombre}` : codigo;
  });
  categorias = signal<LicenciaCategoria[]>([]);

  private resultadoDe(c: ChecklistVehiculo): ChecklistResultado {
    return c.resultado ?? (c.tiene_criticos ? 'bloqueado' : 'aprobado');
  }
  resultadoMeta(c: ChecklistVehiculo) {
    return RESULTADO_META[this.resultadoDe(c)];
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    try {
      const [conductor, stats, checklists, combustible, categorias] = await Promise.all([
        this.conductoresService.getById(id),
        this.conductoresService.getStats(id),
        this.checklistsService.getChecklists(),
        this.combustibleService.getAll(),
        this.conductoresService.getCategoriasLicencia(),
      ]);
      this.conductor.set(conductor);
      this.stats.set(stats);
      this.categorias.set(categorias);
      this.checklists.set(checklists.filter((c) => c.conductor_id === id));
      this.combustible.set(combustible.filter((r) => r.conductor_id === id));
      // S32 — rutas/conduces/entregas/accidentes/multas del conductor (best-effort).
      this.cargarActividad(id, conductor?.usuario_id ?? null);
    } catch (e: unknown) {
      this.toast.error(
        'Error',
        e instanceof Error ? e.message : 'No se pudo cargar el perfil del conductor.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  // ── S32 — actividad completa del conductor ───────────────────
  private async cargarActividad(conductorId: string, usuarioId: string | null) {
    try {
      const [rutas, conduces, entregas, accidentes, multas] = await Promise.all([
        this.rutasService.getAll().catch(() => []),
        this.salidasService.getAll().catch(() => []),
        this.vehiculosService.getResponsabilidad().catch(() => []),
        this.incidencias.accidentesPorConductor(conductorId).catch(() => []),
        this.incidencias.multasPorConductor(conductorId).catch(() => []),
      ]);
      this.rutas.set(rutas.filter((r) => r.conductor_id === conductorId));
      this.conduces.set(conduces.filter((s) => s.conductor_id === conductorId));
      const ent = entregas as unknown as {
        id: string; tipo: string; estado: string; km: number; capturado_en: string;
        conductor_usuario_id: string; vehiculo?: { placa: string };
      }[];
      this.entregas.set(ent.filter((e) => usuarioId != null && e.conductor_usuario_id === usuarioId));
      this.accidentes.set(accidentes);
      this.multas.set(multas);
      const urls = await Promise.all(
        multas.filter((m) => m.documento_path).map(async (m) =>
          [m.documento_path!, await this.incidencias.signedUrl(m.documento_path)] as const,
        ),
      );
      const map: Record<string, string> = {};
      for (const [p, u] of urls) if (u) map[p] = u;
      this.multaDocUrls.set(map);
    } catch {
      /* actividad best-effort */
    }
  }

  multaDocUrl(path: string | null | undefined): string | null {
    return path ? (this.multaDocUrls()[path] ?? null) : null;
  }
  multaBadge(estado: string): string {
    return MULTA_ESTADOS.find((m) => m.value === estado)?.badge ?? 'neutral';
  }
  multaEstadoLabel(estado: string): string {
    return MULTA_ESTADOS.find((m) => m.value === estado)?.label ?? estado;
  }
  entregaTipoLabel(tipo: string): string {
    return tipo === 'recepcion' ? 'Recepción' : tipo === 'devolucion' ? 'Devolución' : tipo;
  }

  // ── FASE 4 — registrar multa (elevados) ──────────────────────
  async openMulta() {
    this.multaForm.reset({ fecha: new Date().toISOString().slice(0, 10), motivo: '', motivoOtro: '', monto: null, estado: 'pendiente' });
    this.multaFile = null;
    if (this.motivosMulta().length === 0) {
      try {
        this.motivosMulta.set(await this.motivosMultaService.getActivos());
      } catch {
        /* catálogo opcional */
      }
    }
    this.multaDrawer.set(true);
  }
  onMultaFile(e: Event) {
    this.multaFile = (e.target as HTMLInputElement).files?.[0] ?? null;
  }
  async guardarMulta() {
    if (this.multaGuardando()) return;
    if (this.multaForm.invalid) { this.multaForm.markAllAsTouched(); return; }
    const uid = this.userService.profile()?.id;
    if (!uid) return;
    this.multaGuardando.set(true);
    const v = this.multaForm.getRawValue();
    try {
      await this.incidencias.crearMulta(
        {
          conductor_id: this.conductorId,
          fecha: v.fecha!,
          motivo: (v.motivo === 'Otro' ? v.motivoOtro?.trim() : v.motivo?.trim()) || null,
          monto: v.monto ?? null,
          vehiculo_id: null,
          accidente_id: null,
          estado: v.estado as MultaEstado,
        },
        uid,
        this.multaFile,
      );
      this.multaDrawer.set(false);
      this.multas.set(await this.incidencias.multasPorConductor(this.conductorId));
      this.toast.success('Multa registrada');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo registrar la multa.');
    } finally {
      this.multaGuardando.set(false);
    }
  }
  async togglePagada(m: ConductorMulta) {
    try {
      await this.incidencias.marcarMultaPagada(m.id, m.estado !== 'pagada');
      this.multas.set(await this.incidencias.multasPorConductor(this.conductorId));
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo actualizar la multa.');
    }
  }
}
