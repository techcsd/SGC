import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormDrawer } from '../form-drawer/form-drawer';
import { Lightbox } from '../../ui/lightbox/lightbox';
import { FlotaIncidenciasService } from '../../services/flota-incidencias.service';
import { ConductorMulta, MULTA_ESTADOS } from '../../models/flota-incidencias.model';
import { formatFechaMedia } from '../../utils/fecha.util';

/**
 * W5-web — detalle abrible de una multa, reutilizable en cualquier vista que las
 * muestre (perfil de conductor, perfil de vehículo, listados). Muestra motivo,
 * monto, estado, vehículo (con link), conductor, fecha y el documento adjunto con
 * preview vía lightbox (W9/W11).
 */
@Component({
  selector: 'app-multa-detalle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormDrawer, Lightbox],
  templateUrl: './multa-detalle.html',
  styleUrl: './multa-detalle.scss',
})
export class MultaDetalle {
  private incidencias = inject(FlotaIncidenciasService);
  private router = inject(Router);

  /** La multa a mostrar; `null` cierra el drawer. */
  multa = input<ConductorMulta | null>(null);
  closed = output<void>();

  formatFecha = formatFechaMedia;
  docUrl = signal<string | null>(null);
  lightboxOpen = signal(false);

  estadoLabel = computed(() => {
    const e = MULTA_ESTADOS.find((x) => x.value === this.multa()?.estado);
    return e?.label ?? this.multa()?.estado ?? '—';
  });
  estadoBadge = computed(() => {
    const e = MULTA_ESTADOS.find((x) => x.value === this.multa()?.estado);
    return e?.badge ?? 'neutral';
  });

  constructor() {
    // Resolver el documento adjunto (cacheado) cuando cambia la multa.
    effect(() => {
      const m = this.multa();
      this.docUrl.set(null);
      this.lightboxOpen.set(false);
      if (m?.documento_path) {
        this.incidencias.signedUrl(m.documento_path).then((u) => this.docUrl.set(u));
      }
    });
  }

  abrirVehiculo() {
    const id = this.multa()?.vehiculo_id;
    if (!id) return;
    this.closed.emit();
    void this.router.navigate(['/flota/vehiculos', id]);
  }
}
