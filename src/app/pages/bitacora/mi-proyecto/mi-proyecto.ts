import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { DocumentosProyecto } from '../../../../shared/components/documentos-proyecto/documentos-proyecto';
import { WeatherCard } from '../../../../shared/context/weather-card/weather-card';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-bitacora-mi-proyecto',
  imports: [DecimalPipe, DocumentosProyecto, WeatherCard, Skeleton],
  templateUrl: './mi-proyecto.html',
  styleUrl: './mi-proyecto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiProyecto implements OnInit {
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  error = signal('');

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const usuarioId = this.userService.profile()?.id;
      if (!usuarioId) throw new Error('Sesión inválida.');
      this.proyectos.set(await this.proyectosService.getAsignadosA(usuarioId));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar tus proyectos.');
    } finally {
      this.loading.set(false);
    }
  }

  faseBadge(estado: string): string {
    const map: Record<string, string> = { pendiente: 'neutral', en_progreso: 'info', completada: 'success' };
    return map[estado] ?? 'neutral';
  }
}
