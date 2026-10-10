import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { UserService } from '../../../app/core/services/user.service';
import { BienvenidaService } from '../../services/bienvenida.service';
import { Icon } from '../../ui/icon/icon';

interface Step {
  /** Nombre de icono SVG (app-icon). AW12 — nunca emoji. */
  icon?: string;
  title: string;
  text: string;
  /** Selector del elemento real a resaltar. Omitir = tarjeta centrada. */
  target?: string;
}

interface Rect { top: number; left: number; width: number; height: number; }

/** CL3 — perfil por rol: saludo + qué resaltar en el 1.er paso del tour. */
interface Perfil { modulo: string; que: string; }
const PERFILES: { codigos: string[]; p: Perfil }[] = [
  { codigos: ['admin'], p: { modulo: 'Administración', que: 'todo el sistema: usuarios, roles y configuración' } },
  { codigos: ['direccion', 'gerencia'], p: { modulo: 'Dirección', que: 'los indicadores y el avance de los proyectos' } },
  { codigos: ['jefe_flota'], p: { modulo: 'Flota', que: 'tus vehículos, rutas, combustible y mantenimientos' } },
  { codigos: ['logistica'], p: { modulo: 'Transporte', que: 'conduces, requisiciones y el apoyo de transporte' } },
  { codigos: ['abogado'], p: { modulo: 'Legal', que: 'expedientes, contratos, aprobaciones y firmas' } },
  { codigos: ['rrhh'], p: { modulo: 'RRHH', que: 'empleados, asistencia y ausencias' } },
  { codigos: ['ingeniero_campo', 'ingeniero_oficina'], p: { modulo: 'Obra', que: 'tu bitácora, requisiciones y personal de obra' } },
  { codigos: ['encargado_almacen', 'bodeguero', 'encargado_patio'], p: { modulo: 'Inventario', que: 'entradas, salidas, conduces y conteos' } },
  { codigos: ['chofer', 'chofer_privado'], p: { modulo: 'Transporte', que: 'tus rutas, conduces y combustible' } },
];
const PERFIL_DEFAULT: Perfil = { modulo: 'tu módulo', que: 'tu trabajo del día a día' };

/**
 * CL3 — Bienvenida web: ventana central con saludo por ROL → tour con foco sobre los
 * elementos reales (menú → avisos → resumen), 3 pasos. Flag EN SERVIDOR por usuario
 * (bienvenida_web_v1_vista) — solo la ven los usuarios nuevos. "Ver otra vez" desde
 * Soporte/Dudas; `?bienvenida=1` la fuerza (dev). reduce-motion = sin movimiento.
 */
@Component({
  selector: 'app-onboarding-web',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './onboarding-web.html',
  styleUrl: './onboarding-web.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class OnboardingWeb {
  private userService = inject(UserService);
  private bienvenida = inject(BienvenidaService);

  /** 'cerrado' | 'ventana' (saludo) | 'tour' (foco sobre la UI). */
  fase = signal<'cerrado' | 'ventana' | 'tour'>('cerrado');
  index = signal(0);
  rect = signal<Rect | null>(null);
  pop = signal<{ top: number; left: number } | null>(null);
  private arrancada = false;

  nombre = computed(() => (this.userService.profile()?.nombre ?? '').split(' ')[0] || '');
  perfil = computed<Perfil>(() => {
    const roles = this.userService.roles();
    for (const { codigos, p } of PERFILES) if (codigos.some((c) => roles.includes(c))) return p;
    return PERFIL_DEFAULT;
  });
  rolLabel = computed(() => this.perfil().modulo.toUpperCase());

  steps = computed<Step[]>(() => [
    {
      icon: 'map',
      title: 'Tu menú',
      text: `Aquí están tus módulos — solo los que tu rol permite. Empieza por ${this.perfil().modulo}: ${this.perfil().que}.`,
      target: '[data-tour="sidebar"]',
    },
    {
      icon: 'alert-circle',
      title: 'Tus avisos',
      text: 'Los números marcan lo que necesita tu atención: solicitudes por aprobar, entregas por confirmar, mensajes sin leer.',
      target: '.nav-badge',
    },
    {
      icon: 'check-circle',
      title: '¡Todo listo!',
      text: 'Eso es todo. Explora con confianza — puedes volver a ver esta guía desde «Soporte» o «Dudas».',
    },
  ]);

  constructor() {
    // Primer ingreso: flag en servidor. Admins incluidos (los existentes ya quedaron
    // marcados por el backfill, así que solo la ven los usuarios realmente nuevos).
    effect(() => {
      const profile = this.userService.profile();
      if (!profile || this.arrancada || this.fase() !== 'cerrado') return;
      this.arrancada = true;
      const forzar = new URLSearchParams(location.search).get('bienvenida') === '1';
      if (forzar) { this.fase.set('ventana'); return; }
      void this.bienvenida.yaVistaWeb().then((vista) => { if (!vista) this.fase.set('ventana'); });
    });
    // "Ver la bienvenida otra vez" (Soporte/Dudas).
    effect(() => {
      if (this.bienvenida.reabrir() > 0) { this.index.set(0); this.fase.set('ventana'); }
    });
  }

  // ── Ventana ───────────────────────────────────────────────────────────────
  mostrarme(): void {
    this.fase.set('tour');
    setTimeout(() => this.goTo(0), 60);
  }
  ahoraNo(): void { this.cerrar(); }

  // ── Tour ──────────────────────────────────────────────────────────────────
  current(): Step { return this.steps()[this.index()]; }
  isLast(): boolean { return this.index() === this.steps().length - 1; }

  goTo(i: number): void {
    const steps = this.steps();
    if (i < 0 || i >= steps.length) return;
    this.index.set(i);
    const el = steps[i].target ? (document.querySelector(steps[i].target!) as HTMLElement | null) : null;
    if (!el) { this.rect.set(null); this.pop.set(null); return; }
    el.scrollIntoView({ block: 'center', behavior: this.reducido() ? 'auto' : 'smooth' });
    setTimeout(() => this.measure(el), this.reducido() ? 0 : 240);
  }
  next(): void { if (this.isLast()) this.cerrar(); else this.goTo(this.index() + 1); }
  prev(): void { this.goTo(Math.max(0, this.index() - 1)); }
  skip(): void { this.cerrar(); }

  private reducido(): boolean {
    try {
      return document.documentElement.classList.contains('motion-reduced') ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch { return false; }
  }

  private measure(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const pad = 6;
    const rect: Rect = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    this.rect.set(rect);
    this.pop.set(this.placePop(rect));
  }

  private placePop(rect: Rect): { top: number; left: number } {
    const vw = window.innerWidth, vh = window.innerHeight, tw = 330, th = 220, gap = 16;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    if (rect.left + rect.width < vw * 0.5 && rect.left + rect.width + gap + tw < vw) {
      return { left: rect.left + rect.width + gap, top: clamp(rect.top, 12, vh - th - 12) };
    }
    if (rect.top + rect.height + gap + th < vh) {
      return { left: clamp(rect.left, 12, vw - tw - 12), top: rect.top + rect.height + gap };
    }
    return { left: clamp(rect.left, 12, vw - tw - 12), top: Math.max(12, rect.top - th - gap) };
  }

  /** Cierra y marca como vista (servidor). */
  cerrar(): void {
    if (this.fase() === 'cerrado') return;
    this.fase.set('cerrado');
    this.rect.set(null);
    void this.bienvenida.marcarVistaWeb();
  }

  spotStyle(): Record<string, string> {
    const r = this.rect();
    return r ? { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' } : {};
  }
  popStyle(): Record<string, string> {
    const p = this.pop();
    return p ? { top: p.top + 'px', left: p.left + 'px' } : {};
  }
}
