import { Component, ChangeDetectionStrategy, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { LogoRevealService } from './logo-reveal.service';
import { MOTION_IDS } from '../../motion/catalogo-movimiento';

/**
 * CM2 — "Logo reveal" al entrar (variante A · Trazo del mock Logo.dc.html): el símbolo
 * SD se dibuja, el punto rebota, el texto se descubre y el subrayado crece; velo navy
 * #0f1f33. No bloquea la navegación (se monta en el root a la vez que se navega). Se va
 * al pasar ≥1,2s (máx 2,2s) o al tocar/tecla. reduce-motion = estático + fundido 200ms.
 * Registrado en el catálogo CL5 como `login-reveal`.
 */
@Component({
  selector: 'app-logo-reveal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './logo-reveal.html',
  styleUrl: './logo-reveal.scss',
  host: {
    '(click)': 'saltar()',
    '(document:keydown)': 'saltar()',
  },
})
export class LogoReveal implements OnInit, OnDestroy {
  readonly motionId = MOTION_IDS.loginReveal;
  reveal = inject(LogoRevealService);
  reducido = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    try {
      this.reducido.set(
        document.documentElement.classList.contains('motion-reduced') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      );
    } catch { /* noop */ }
    // Auto-cierre: ~1,8s (dentro de 1,2-2,2s). reduce-motion = 1,2s.
    const dur = this.reducido() ? 1200 : 1800;
    this.timer = setTimeout(() => this.reveal.cerrar(), dur);
  }

  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); }

  saltar(): void { this.reveal.cerrar(); }
}
