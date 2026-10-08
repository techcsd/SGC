import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MotionService } from '../../services/motion.service';

/**
 * CJ2 — Celebración global al crear un conduce (papel sube → sello EMITIDO → carpeta →
 * check + "Conduce creado · número · destino" + "Ver conduce"). No bloquea; tocar o Esc
 * la salta. reduce-motion = aparece el check sin la animación (el CSS global anula el
 * movimiento). Montado una sola vez en el shell; lo dispara `MotionService.celebrar(...)`.
 */
@Component({
  selector: 'app-celebracion',
  imports: [],
  templateUrl: './celebracion.html',
  styleUrl: './celebracion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'motion.cerrar()' },
})
export class Celebracion {
  motion = inject(MotionService);
  private router = inject(Router);

  ver() {
    const url = this.motion.datos().verUrl;
    this.motion.cerrar();
    if (url) void this.router.navigateByUrl(url);
  }
}
