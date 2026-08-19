import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { SalidasService, ConducePorImplementar } from '../../../../shared/services/salidas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * AY13 — "Conduces por implementar": conduces que tienen ≥1 item libre (material no
 * catalogado, AU4) todavía sin vincular a un artículo real. Es la vista a nivel de
 * CONDUCE (la bandeja de material-no-catalogado es a nivel de item). Al vincular
 * todos los items de un conduce, éste desaparece de la lista. Desde aquí se salta a
 * la bandeja para crear/vincular el artículo (y decidir per-case si genera movimiento).
 */
@Component({
  selector: 'app-conduces-por-implementar',
  imports: [RouterLink, DatePipe, Skeleton],
  templateUrl: './conduces-por-implementar.html',
  styleUrl: './conduces-por-implementar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConducesPorImplementar implements OnInit {
  private svc = inject(SalidasService);
  private toast = inject(ToastService);

  filas = signal<ConducePorImplementar[]>([]);
  loading = signal(true);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.filas.set(await this.svc.getConducesPorImplementar());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los conduces por implementar.');
    } finally {
      this.loading.set(false);
    }
  }
}
