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
import { ConductoresService } from '../../../../../shared/services/conductores.service';
import { ChecklistsVehiculoService } from '../../../../../shared/services/checklists-vehiculo.service';
import { CombustibleService } from '../../../../../shared/services/combustible.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { FlotaConfigService } from '../../../../../shared/services/flota-config.service';
import { Conductor, LicenciaCategoria } from '../../../../../shared/models/conductor.model';
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
import { formatFechaDisplay, daysUntil } from '../../../../../shared/utils/fecha.util';

const MAX_HIST = 15;

@Component({
  selector: 'app-conductor-detalle',
  imports: [DecimalPipe, RouterLink, Skeleton, DocumentosFlota],
  templateUrl: './conductor-detalle.html',
  styleUrl: './conductor-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConductorDetalle implements OnInit {
  private route = inject(ActivatedRoute);
  private conductoresService = inject(ConductoresService);
  private checklistsService = inject(ChecklistsVehiculoService);
  private combustibleService = inject(CombustibleService);
  private toast = inject(ToastService);
  private flotaConfig = inject(FlotaConfigService);

  readonly estadoLabel = ESTADO_LICENCIA_LABEL;
  readonly estadoBadge = ESTADO_LICENCIA_BADGE;
  formatFecha = formatFechaDisplay;

  // tipo de documento a auto-abrir cuando se llega desde un aviso (?doc=licencia)
  readonly docAuto = this.route.snapshot.queryParamMap.get('doc');

  loading = signal(true);
  conductor = signal<Conductor | null>(null);
  stats = signal<ConductorStats | null>(null);
  checklists = signal<ChecklistVehiculo[]>([]);
  combustible = signal<RegistroCombustible[]>([]);

  // Últimos ~15 checklists del conductor (ya vienen ordenados por captura desc).
  histChecklists = computed(() => this.checklists().slice(0, MAX_HIST));

  // Últimas ~15 echadas de combustible del conductor (getAll viene por fecha desc).
  histCombustible = computed(() => this.combustible().slice(0, MAX_HIST));

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
    } catch (e: unknown) {
      this.toast.error(
        'Error',
        e instanceof Error ? e.message : 'No se pudo cargar el perfil del conductor.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
