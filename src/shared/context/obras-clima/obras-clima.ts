import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ObrasClimaService, ObraClima } from '../obras-clima.service';
import { Recomendacion, interpretarCodigoTiempo } from '../weather.model';

/** Reusable panel that shows current weather + the top construction advisory for
 *  every active obra. Self-loading, so any page (Dashboard, Dirección) can drop in
 *  <app-obras-clima /> and get the same context-driven view. */
@Component({
  selector: 'app-obras-clima',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './obras-clima.html',
  styleUrl: './obras-clima.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObrasClima implements OnInit {
  private service = inject(ObrasClimaService);

  obras = signal<ObraClima[]>([]);
  loading = signal(true);
  error = signal('');

  async ngOnInit() {
    await this.cargar();
  }

  async recargar() {
    await this.cargar(true);
  }

  private async cargar(force = false) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.obras.set(await this.service.getClimaObrasActivas({ force }));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el clima de las obras.');
    } finally {
      this.loading.set(false);
    }
  }

  tiempo(o: ObraClima) {
    return interpretarCodigoTiempo(o.contexto.pronostico.actual.codigoTiempo);
  }

  /** The advisory that matches the worst risk level (what the user should see first). */
  destacada(o: ObraClima): Recomendacion {
    return o.contexto.recomendaciones.find((r) => r.nivel === o.peorNivel) ?? o.contexto.recomendaciones[0];
  }
}
