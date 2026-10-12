import { Component, ChangeDetectionStrategy, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { PracticaService } from '../../../app/core/practica/practica.service';
import { PracticaClienteService } from '../../../app/core/practica/practica-cliente.service';
import { ResultadoPractica } from '../../../app/core/practica/practica.model';

/**
 * CM7 7b — "shell" de práctica para las misiones con PANTALLA REAL. Cuando una misión con
 * `rutaReal` está activa, muestra la banda naranja fija ("MODO PRÁCTICA · datos de mentira"),
 * el cronómetro, los objetivos en vivo y "Salir". Cuando el usuario completa la tarea (aparece
 * `metaWrite` en las escrituras de memoria), muestra el resultado (nota, estrellas, consejos)
 * y guarda la nota. Montado una vez en el shell.
 */
@Component({
  selector: 'app-practica-banda',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './practica-banda.html',
  styleUrl: './practica-banda.scss',
})
export class PracticaBanda implements OnDestroy {
  practica = inject(PracticaService);
  private pc = inject(PracticaClienteService);
  private router = inject(Router);

  resultado = signal<ResultadoPractica | null>(null);
  cronometro = signal('0:00');
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Solo visible en misiones de pantalla real. */
  visible = computed(() => this.practica.activa() && !!this.practica.mision()?.rutaReal);
  titulo = computed(() => this.practica.mision()?.titulo ?? 'Práctica');

  /** Objetivos en vivo (reactivo a las escrituras de memoria). */
  objetivos = computed(() => {
    this.pc.cambios(); // dispara recálculo con cada escritura
    return this.practica.evaluarReal().objetivos;
  });
  cumplidos = computed(() => this.objetivos().filter((o) => o.ok).length);

  constructor() {
    // Cronómetro mientras la banda esté visible.
    effect(() => {
      if (this.visible() && !this.timer) {
        this.timer = setInterval(() => this.tick(), 1000);
      } else if (!this.visible() && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
    // Auto-resultado al completar la tarea.
    effect(() => {
      if (this.visible() && this.practica.metaCumplida() && !this.resultado()) {
        void this.mostrarResultado();
      }
    });
  }

  private tick() {
    const s = this.practica.evaluarReal().duracionS;
    this.cronometro.set(`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`);
  }

  async mostrarResultado() {
    const res = this.practica.evaluarReal();
    this.resultado.set(res);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.practica.guardar(res);
  }

  /** "Ya terminé": evalúa y muestra el resultado aunque no haya disparado la meta. */
  terminar() { void this.mostrarResultado(); }

  repetir() {
    const m = this.practica.mision();
    if (!m) return;
    this.resultado.set(null);
    this.practica.entrar(m); // reinicia el cliente de práctica (borra escrituras)
    if (m.rutaReal) void this.router.navigate([m.rutaReal]);
  }

  salir() {
    this.resultado.set(null);
    this.practica.salir();
    void this.router.navigate(['/practica']);
  }

  estrellasArr(n: number): boolean[] { return [0, 1, 2].map((i) => i < n); }

  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
}
