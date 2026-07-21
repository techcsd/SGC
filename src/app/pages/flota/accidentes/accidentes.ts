import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FlotaIncidenciasService } from '../../../../shared/services/flota-incidencias.service';
import { VehiculoAccidente, ACCIDENTE_FASES } from '../../../../shared/models/flota-incidencias.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * S22 — Submódulo "Accidentes": los formularios de choque completos (no solo el
 * acta AMET) en una lista con detalle. En el perfil del vehículo solo se ven los
 * que tienen acta AMET; aquí se ven todos.
 */
@Component({
  selector: 'app-flota-accidentes',
  imports: [FormDrawer, Skeleton],
  templateUrl: './accidentes.html',
  styleUrl: './accidentes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Accidentes implements OnInit {
  private incidencias = inject(FlotaIncidenciasService);
  formatFecha = formatFechaDisplay;

  loading = signal(true);
  error = signal('');
  accidentes = signal<VehiculoAccidente[]>([]);

  detailOpen = signal(false);
  detail = signal<VehiculoAccidente | null>(null);
  ametUrl = signal<string | null>(null);

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.accidentes.set(await this.incidencias.accidentesTodos());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los accidentes.');
    } finally {
      this.loading.set(false);
    }
  }

  faseLabel(f: string): string {
    return ACCIDENTE_FASES.find((x) => x.value === f)?.label ?? f;
  }

  async openDetail(a: VehiculoAccidente) {
    this.detail.set(a);
    this.ametUrl.set(null);
    this.detailOpen.set(true);
    if (a.reporte_amet_path) {
      this.ametUrl.set(await this.incidencias.signedUrl(a.reporte_amet_path));
    }
  }

  closeDetail() {
    this.detailOpen.set(false);
    this.detail.set(null);
  }
}
