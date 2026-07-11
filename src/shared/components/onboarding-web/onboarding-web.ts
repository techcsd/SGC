import {
  Component,
  ChangeDetectionStrategy,
  HostListener,
  inject,
  signal,
  effect,
} from '@angular/core';
import { UserService } from '../../../app/core/services/user.service';

interface Step {
  icon?: string;
  title: string;
  text: string;
  /** CSS selector of the real element to spotlight. Omit for a centered card. */
  target?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// The tour walks the user through the real UI, spotlighting each piece as it
// explains it — show, don't just tell.
const STEPS: Step[] = [
  {
    icon: '👋',
    title: 'Bienvenido al SGC',
    text: 'Te muestro lo esencial en unos segundos. Puedes saltarlo cuando quieras.',
  },
  {
    title: 'Tu menú',
    text: 'Aquí están tus módulos. Solo ves los que tu rol permite. Haz clic en uno para desplegar sus opciones.',
    target: '[data-tour="sidebar"]',
  },
  {
    title: 'Pendientes',
    text: 'Los números rojos indican cosas que requieren tu atención: solicitudes por aprobar, entregas por confirmar, mensajes sin leer.',
    target: '.nav-badge',
  },
  {
    title: 'App de campo',
    text: 'Desde aquí descargas la CSD App. Lo que el personal registra en obra (bitácoras, entregas, materiales) llega solo al sistema.',
    target: '[data-tour="csd-app"]',
  },
  {
    title: '¿Necesitas ayuda?',
    text: 'Entra a “Soporte” o “Dudas” cuando tengas una pregunta o encuentres un problema.',
    target: '[data-tour="soporte"]',
  },
  {
    title: 'Tu perfil',
    text: 'Tu cuenta, tu foto y el botón de cerrar sesión están aquí arriba.',
    target: '[data-tour="user"]',
  },
  {
    icon: '✅',
    title: '¡Listo!',
    text: 'Eso es todo. Explora con confianza — puedes volver a ver esta guía desde “Soporte”.',
  },
];

const DONE_KEY = 'sgc_onboarding_v1_done';

/**
 * First-run guided tour for new non-admin users. Dims the screen and spotlights
 * each real UI element (sidebar, badges, links…) while explaining it. Shows once
 * (localStorage flag); admins are skipped. Self-gates from the shell.
 */
@Component({
  selector: 'app-onboarding-web',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding-web.html',
  styleUrl: './onboarding-web.scss',
})
export class OnboardingWeb {
  private userService = inject(UserService);

  readonly steps = STEPS;
  visible = signal(false);
  index = signal(0);
  /** Spotlight rectangle for the current step, or null for a centered card. */
  rect = signal<Rect | null>(null);
  /** Tooltip position when anchored to a target. */
  pop = signal<{ top: number; left: number } | null>(null);

  constructor() {
    effect(() => {
      const profile = this.userService.profile();
      if (!profile) return;
      if (this.visible()) return;
      const alreadyDone = localStorage.getItem(DONE_KEY) === '1';
      const isAdmin = this.userService.hasRole('admin');
      if (isAdmin) {
        localStorage.setItem(DONE_KEY, '1');
      } else if (!alreadyDone) {
        this.start();
      }
    });
  }

  start(): void {
    this.visible.set(true);
    // Let the shell paint before measuring targets.
    setTimeout(() => this.goTo(0), 60);
  }

  current(): Step {
    return this.steps[this.index()];
  }
  isLast(): boolean {
    return this.index() === this.steps.length - 1;
  }

  goTo(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    this.index.set(i);
    const step = this.steps[i];
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (!el) {
      this.rect.set(null);
      this.pop.set(null);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => this.measure(el), 240);
  }

  next(): void {
    if (this.isLast()) {
      this.finish();
      return;
    }
    this.goTo(this.index() + 1);
  }
  prev(): void {
    this.goTo(Math.max(0, this.index() - 1));
  }
  skip(): void {
    this.finish();
  }

  private measure(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const pad = 6;
    const rect: Rect = {
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    this.rect.set(rect);
    this.pop.set(this.placePop(rect));
  }

  private placePop(rect: Rect): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = 330;
    const th = 220;
    const gap = 16;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    // Prefer right side for left-anchored targets (sidebar), else below, else above.
    if (rect.left + rect.width < vw * 0.5 && rect.left + rect.width + gap + tw < vw) {
      return {
        left: rect.left + rect.width + gap,
        top: clamp(rect.top, 12, vh - th - 12),
      };
    }
    if (rect.top + rect.height + gap + th < vh) {
      return {
        left: clamp(rect.left, 12, vw - tw - 12),
        top: rect.top + rect.height + gap,
      };
    }
    return {
      left: clamp(rect.left, 12, vw - tw - 12),
      top: Math.max(12, rect.top - th - gap),
    };
  }

  private finish(): void {
    this.visible.set(false);
    this.rect.set(null);
    localStorage.setItem(DONE_KEY, '1');
  }

  spotStyle(): Record<string, string> {
    const r = this.rect();
    if (!r) return {};
    return {
      top: r.top + 'px',
      left: r.left + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    };
  }

  popStyle(): Record<string, string> {
    const p = this.pop();
    if (!p) return {};
    return { top: p.top + 'px', left: p.left + 'px' };
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.visible()) return;
    const step = this.current();
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (el) this.measure(el);
  }
}
