import { Component, ChangeDetectionStrategy, inject, input, signal, computed, effect } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ContextService, ContextoObra } from '../context.service';
import { interpretarCodigoTiempo } from '../weather.model';

@Component({
  selector: 'app-weather-card',
  imports: [DecimalPipe],
  templateUrl: './weather-card.html',
  styleUrl: './weather-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeatherCard {
  private contextService = inject(ContextService);

  latitud = input<number | null>(null);
  longitud = input<number | null>(null);
  titulo = input<string>('Clima en obra');

  contexto = signal<ContextoObra | null>(null);
  loading = signal(false);
  error = signal('');

  tiempo = computed(() => interpretarCodigoTiempo(this.contexto()?.pronostico.actual.codigoTiempo ?? null));

  constructor() {
    effect(() => {
      const lat = this.latitud();
      const lng = this.longitud();
      if (lat == null || lng == null) {
        this.contexto.set(null);
        return;
      }
      void this.cargar(lat, lng);
    });
  }

  private async cargar(latitud: number, longitud: number) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.contexto.set(await this.contextService.getContexto({ latitud, longitud }));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el clima.');
    } finally {
      this.loading.set(false);
    }
  }

  nivelClass(nivel: string): string {
    switch (nivel) {
      case 'peligro': return 'rec--peligro';
      case 'precaucion': return 'rec--precaucion';
      default: return 'rec--info';
    }
  }
}
