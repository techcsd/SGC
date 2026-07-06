import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { SalidasService } from '../../../../shared/services/salidas.service';
import {
  SalidaInventario,
  SALIDA_ESTADO_LABELS,
  MOTIVOS_SALIDA,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { formatFechaDisplay, formatTimestampDisplay, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-conduce',
  imports: [],
  templateUrl: './conduce.html',
  styleUrl: './conduce.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduce implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private salidasService = inject(SalidasService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  readonly hoy = todayIso();
  readonly numeroConduce: string;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  salida = signal<SalidaInventario | null>(null);
  loading = signal(true);
  error = signal('');

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.numeroConduce = conduceNumero(id);
  }

  motivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Salida no especificada.');
      this.loading.set(false);
      return;
    }
    try {
      this.salida.set(await this.salidasService.getById(id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la salida.');
    } finally {
      this.loading.set(false);
    }
  }

  imprimir() {
    window.print();
  }

  /** Go back to wherever the user came from (Salidas, the Conduces list, or the
   *  engineer's Entregas page). Falls back to the dashboard on a direct hit. */
  volver() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
