import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TransporteV3Service, ConduceExternoRow } from '../../../../shared/services/transporte-v3.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { UserService } from '../../../core/services/user.service';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/** BA / Transporte v3 — historial de conduces externos (tipo visible, AU15). */
@Component({
  selector: 'app-conduces-externos',
  imports: [RouterLink, Skeleton, DatePipe, TranslatePipe],
  templateUrl: './conduces-externos.html',
  styleUrl: './conduces-externos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConducesExternos {
  private svc = inject(TransporteV3Service);
  private user = inject(UserService);

  filas = signal<ConduceExternoRow[]>([]);
  loading = signal(true);
  error = signal('');
  filtroEstado = signal<'todos' | 'emitido' | 'recibido' | 'anulado'>('todos');

  // CL6 — los de prueba se ocultan salvo que el admin active "Mostrar datos de prueba".
  esAdmin = computed(() => this.user.hasRole('admin'));
  mostrarPrueba = signal(false);
  hayPrueba = computed(() => this.filas().some((r) => r.es_prueba));

  filtradas = computed(() => {
    const f = this.filtroEstado();
    const verPrueba = this.mostrarPrueba();
    return this.filas().filter(
      (r) => (f === 'todos' || r.estado === f) && (verPrueba || !r.es_prueba),
    );
  });

  async ngOnInit() {
    await this.recargar();
  }

  async recargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.filas.set(await this.svc.conducesExternos());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  estadoBadge(e: string): string {
    return e === 'recibido' ? 'success' : e === 'anulado' ? 'danger' : 'info';
  }
  estadoLabel(e: string): string {
    return e === 'recibido' ? 'Recibido' : e === 'anulado' ? 'Anulado' : 'Emitido';
  }
}
