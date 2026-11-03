import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PracticaService } from '../../../core/practica/practica.service';
import { UserService } from '../../../core/services/user.service';
import { misionesParaRoles } from '../../../core/practica/practica.data';
import { ResultadoPersonaFila, MisionPractica } from '../../../core/practica/practica.model';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';

/** F6 (DG5) — una fila de la lista "Mi progreso": la misión del catálogo + el resultado
 *  (si ya se practicó) o null (si está pendiente). */
interface FilaProgreso {
  mision: MisionPractica;
  resultado: ResultadoPersonaFila | null;
}

/**
 * F6 (DG5) — "Mi progreso" (módulo Demo): cuántas misiones completó el usuario, su nota, y
 * cuáles le quedan pendientes. Reusa `practica_resultados_persona` (ya existe desde CM7 7c,
 * visible para uno mismo vía RLS `usuario_id = auth.uid()`) — no se inventa un RPC nuevo.
 */
@Component({
  selector: 'app-demo-progreso',
  imports: [RouterLink, TranslatePipe, StaggerDirective],
  templateUrl: './demo-progreso.html',
  styleUrl: './demo-progreso.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoProgreso implements OnInit {
  private practica = inject(PracticaService);
  private user = inject(UserService);

  cargando = signal(true);
  error = signal('');
  detalle = signal<ResultadoPersonaFila[]>([]);

  catalogo = computed<MisionPractica[]>(() => misionesParaRoles(this.user.roles()));

  filas = computed<FilaProgreso[]>(() => {
    const det = this.detalle();
    return this.catalogo().map((mision) => ({
      mision,
      resultado: det.find((d) => d.mision_id === mision.id) ?? null,
    }));
  });

  totalMisiones = computed(() => this.catalogo().length);
  completadas = computed(() => this.filas().filter((f) => f.resultado?.aprobada).length);
  pendientes = computed(() => this.filas().filter((f) => !f.resultado).length);
  promedioNota = computed(() => {
    const notas = this.detalle().map((d) => d.mejor_nota).filter((n): n is number => n != null);
    if (!notas.length) return null;
    return Math.round(notas.reduce((s, n) => s + n, 0) / notas.length);
  });

  async ngOnInit() {
    const uid = this.user.profile()?.id;
    if (!uid) { this.cargando.set(false); return; }
    try {
      this.detalle.set(await this.practica.resultadosPersona(uid));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar tu progreso.');
    } finally {
      this.cargando.set(false);
    }
  }

  estado(f: FilaProgreso): 'pendiente' | 'intentada' | 'aprobada' {
    if (!f.resultado) return 'pendiente';
    return f.resultado.aprobada ? 'aprobada' : 'intentada';
  }

  trackFila(_i: number, f: FilaProgreso) { return f.mision.id; }
}
