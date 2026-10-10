import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { FirmaPendienteBandeja, FIRMA_ROL_LABEL, FirmaRol } from '../../../../shared/models/personal-obra.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

/** CF1 — Bandeja de documentos de personal con firmas (empleador/testigos) pendientes. */
@Component({
  selector: 'app-firmas-pendientes',
  imports: [RouterLink, Skeleton, StaggerDirective],
  templateUrl: './firmas-pendientes.html',
  styleUrl: './firmas-pendientes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FirmasPendientes implements OnInit {
  private service = inject(PersonalObraService);
  readonly formatFecha = formatFechaHumana;
  readonly rolLabel = FIRMA_ROL_LABEL;

  filas = signal<FirmaPendienteBandeja[]>([]);
  loading = signal(true);
  error = signal('');

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(await this.service.firmasPendientes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las firmas pendientes.');
    } finally {
      this.loading.set(false);
    }
  }

  rolesTxt(roles: FirmaRol[] | null): string {
    return (roles ?? []).map((r) => this.rolLabel[r]).join(', ');
  }
}
