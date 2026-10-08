import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrabajosTransporteService, ChoferPanel } from '../../../shared/services/trabajos-transporte.service';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { formatFechaRelativa } from '../../../shared/utils/fecha.util';

const ESTADO_LABEL: Record<string, string> = {
  en_ruta: 'En ruta', disponible: 'Disponible', descanso: 'Descanso',
  almuerzo: 'Almuerzo', inactivo: 'Inactivo', otros: 'Otros', sin_estado: 'Sin estado',
};

@Component({
  selector: 'app-mis-choferes',
  imports: [RouterLink, Skeleton],
  templateUrl: './mis-choferes.html',
  styleUrl: './mis-choferes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MisChoferes implements OnInit {
  private svc = inject(TrabajosTransporteService);

  loading = signal(true);
  choferes = signal<ChoferPanel[]>([]);

  readonly estadoLabel = (e: string) => ESTADO_LABEL[e] ?? e;
  readonly rel = formatFechaRelativa;

  async ngOnInit() {
    try {
      this.choferes.set(await this.svc.misChoferes());
    } finally {
      this.loading.set(false);
    }
  }

  /** Semáforo de última señal: verde <10min, ámbar <1h, rojo más / sin señal. */
  senal(c: ChoferPanel): 'ok' | 'warn' | 'bad' {
    if (!c.ultima_senal) return 'bad';
    const min = (Date.now() - new Date(c.ultima_senal).getTime()) / 60000;
    return min < 10 ? 'ok' : min < 60 ? 'warn' : 'bad';
  }

  senalTexto(c: ChoferPanel): string {
    if (!c.ultima_senal) return 'Sin señal';
    return this.rel(c.ultima_senal);
  }

  async recargar() {
    this.loading.set(true);
    try { this.choferes.set(await this.svc.misChoferes()); } finally { this.loading.set(false); }
  }
}
