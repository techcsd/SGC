import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
} from '@angular/core';
import { UserService } from '../../../app/core/services/user.service';

interface Slide {
  icon: string;
  title: string;
  text: string;
}

const SLIDES: Slide[] = [
  {
    icon: '👋',
    title: 'Bienvenido al SGC',
    text: 'Este es el sistema de gestión de Constructora S&D. Desde aquí administras inventario, compras, proyectos, flota, bitácoras y más — todo en un solo lugar.',
  },
  {
    icon: '🧭',
    title: 'Menú lateral',
    text: 'En la barra de la izquierda están tus módulos. Solo verás los que tu rol tiene habilitados. Haz clic en cada uno para desplegar sus opciones.',
  },
  {
    icon: '🔔',
    title: 'Pendientes y avisos',
    text: 'Los números rojos junto a un módulo indican cosas que requieren tu atención: solicitudes por aprobar, entregas por confirmar, mensajes sin leer.',
  },
  {
    icon: '📱',
    title: 'App de campo (CSD App)',
    text: 'Lo que el personal registra desde la app móvil (bitácoras, entregas, conduces, materiales) llega aquí automáticamente. Busca "CSD App (móvil)" para el enlace de descarga.',
  },
  {
    icon: '🛟',
    title: '¿Dudas?',
    text: 'Entra a "Soporte" o "Dudas" en el menú cuando necesites ayuda. ¡Listo para empezar!',
  },
];

const DONE_KEY = 'sgc_onboarding_v1_done';

/**
 * First-run guide for NEW users of the web. Shows a few skippable slides the
 * first time a non-admin user loads the shell, then never again (localStorage
 * flag). Admins are skipped (they build/know the system). Self-gates: the shell
 * always renders it; it stays hidden unless it should show.
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

  readonly slides = SLIDES;
  visible = signal(false);
  index = signal(0);

  constructor() {
    // Wait until the profile (and thus roles) is loaded, then decide once.
    effect(() => {
      const profile = this.userService.profile();
      if (!profile) return;
      if (this.visible()) return;
      const alreadyDone = localStorage.getItem(DONE_KEY) === '1';
      const isAdmin = this.userService.hasRole('admin');
      if (!alreadyDone && !isAdmin) {
        this.visible.set(true);
      } else if (isAdmin) {
        // Never nag the admin/developer role — mark done silently.
        localStorage.setItem(DONE_KEY, '1');
      }
    });
  }

  isLast(): boolean {
    return this.index() === SLIDES.length - 1;
  }

  next(): void {
    if (this.isLast()) {
      this.finish();
      return;
    }
    this.index.update((i) => i + 1);
  }

  prev(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  skip(): void {
    this.finish();
  }

  private finish(): void {
    this.visible.set(false);
    localStorage.setItem(DONE_KEY, '1');
  }
}
