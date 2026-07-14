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
import { Conductor } from '../../../../../shared/models/conductor.model';
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
import { formatFechaDisplay } from '../../../../../shared/utils/fecha.util';

const MAX_HIST = 15;

@Component({
  selector: 'app-conductor-detalle',
  imports: [DecimalPipe, RouterLink, Skeleton],
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

  readonly estadoLabel = ESTADO_LICENCIA_LABEL;
  readonly estadoBadge = ESTADO_LICENCIA_BADGE;
  formatFecha = formatFechaDisplay;

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
      const [conductor, stats, checklists, combustible] = await Promise.all([
        this.conductoresService.getById(id),
        this.conductoresService.getStats(id),
        this.checklistsService.getChecklists(),
        this.combustibleService.getAll(),
      ]);
      this.conductor.set(conductor);
      this.stats.set(stats);
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
