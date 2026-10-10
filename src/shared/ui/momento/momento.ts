import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { MotionService, MomentoTipo } from '../../services/motion.service';

/**
 * CL2 — Momento "mediano" (~0.8s, SIN velo): confirmación importante de una acción de
 * éxito (entrada, salida, aprobación, firma, combustible, checklist, mantenimiento,
 * mensaje, documento). No bloquea; se cierra solo. `aria-live` con el texto. reduce-motion
 * = aparece sin movimiento. Montado una vez en el shell; lo dispara `MotionService.momento`.
 */
@Component({
  selector: 'app-momento',
  imports: [],
  templateUrl: './momento.html',
  styleUrl: './momento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Momento {
  motion = inject(MotionService);

  /** Texto por defecto por tipo (si no se pasó datos.texto). */
  private labels: Record<MomentoTipo, string> = {
    entrada: 'Entrada registrada',
    salida: 'Salida registrada',
    aprobado: 'Aprobado',
    firma: 'Firma registrada',
    combustible: 'Combustible registrado',
    checklist: 'Checklist completado',
    mantenimiento: 'Mantenimiento cerrado',
    mensaje: 'Enviado',
    documento: 'Documento generado',
  };

  texto = computed(() => this.motion.momentoDatos().texto || this.labels[this.motion.momentoTipo()]);
}
