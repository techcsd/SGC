import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { SalidaInventario } from '../../../../shared/models/salida.model';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-conduce',
  imports: [RouterLink],
  templateUrl: './conduce.html',
  styleUrl: './conduce.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduce implements OnInit {
  private route = inject(ActivatedRoute);
  private salidasService = inject(SalidasService);

  formatFecha = formatFechaDisplay;
  readonly hoy = todayIso();
  readonly numeroConduce: string;

  salida = signal<SalidaInventario | null>(null);
  loading = signal(true);
  error = signal('');

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.numeroConduce = 'CND-' + id.slice(0, 8).toUpperCase();
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
}
