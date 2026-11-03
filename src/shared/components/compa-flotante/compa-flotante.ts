import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { Asistente } from '../../../app/pages/asistente/asistente';
import { PreferenciasService } from '../../services/preferencias.service';
import { TranslatePipe } from '../../i18n/translate.pipe';
import {
  Punto,
  Tamano,
  TAMANO_DEFECTO,
  clamparPosicion,
  clamparTamano,
  moverConTeclado,
  posicionPorDefecto,
  TeclaMovimiento,
} from './compa-flotante-geometria.util';

const CLAVE_GEOMETRIA = 'compa.flotante.geometria';
const TECLAS_MOVIMIENTO: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

interface GeometriaGuardada {
  posicion: Punto;
  tamano: Tamano;
}

/**
 * DG — "Compa flotante": burbuja abajo-a-la-derecha → ventana arrastrable y
 * redimensionable, montada UNA vez en el shell (fuera del `<router-outlet>`) para
 * que Compa esté disponible sin importar el módulo activo. Reusa el contenido real
 * de `/asistente` (`<app-asistente compacto>`) — misma `AsistenteService`, cero
 * lógica de chat duplicada.
 *
 * Mínima cuota de red: `<app-asistente>` se monta recién al primer `abrir()` (lazy)
 * y desde ahí NUNCA se destruye (se oculta con `[hidden]`, no con `@if`) — así la
 * conversación/scroll/borrador sobreviven cerrar↔abrir y cambios de ruta sin volver
 * a pedir nada al servidor. La visibilidad del COMPONENTE completo (preferencia /
 * pantalla /asistente / práctica activa) la decide el shell (`compaFlotanteVisible`
 * en `compa-flotante-visibilidad.util.ts`), no este componente.
 */
@Component({
  selector: 'app-compa-flotante',
  imports: [Asistente, TranslatePipe],
  templateUrl: './compa-flotante.html',
  styleUrl: './compa-flotante.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onViewportResize()',
  },
})
export class CompaFlotante {
  private preferencias = inject(PreferenciasService);
  private destroyRef = inject(DestroyRef);

  /** DG — módulo activo, ya resuelto por el shell contra el MISMO índice de menú
   *  que usa el buscador maestro (`moduloActualDesdeRuta`). Null = sin match (p. ej.
   *  una pantalla sin entrada de menú). */
  moduloActual = input<string | null>(null);

  abierta = signal(false);
  minimizada = signal(false);
  /** Lazy: `<app-asistente>` no se monta hasta el primer `abrir()` (ver cabecera). */
  montada = signal(false);

  esMovil = signal(
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches === true,
  );

  tamano = signal<Tamano>(TAMANO_DEFECTO);
  posicion = signal<Punto | null>(null);

  arrastrando = signal(false);
  redimensionando = signal(false);

  private recordarPosicion = computed(() => this.preferencias.prefs()?.compa_flotante_recordar_posicion ?? true);

  /** Estilo inline de la ventana flotante; vacío en móvil (la hoja la posiciona el CSS). */
  estiloVentana = computed<Record<string, string>>(() => {
    const vacio: Record<string, string> = {};
    if (this.esMovil()) return vacio;
    const pos = this.posicion();
    const tam = this.tamano();
    if (!pos) return vacio;
    return {
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${tam.w}px`,
      height: `${tam.h}px`,
    };
  });

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(max-width: 768px)');
      const onMq = (e: MediaQueryListEvent) => this.esMovil.set(e.matches);
      mq.addEventListener('change', onMq);
      this.destroyRef.onDestroy(() => mq.removeEventListener('change', onMq));
    }
  }

  private viewport(): Tamano {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  private storage(): Storage | undefined {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
      return undefined;
    }
  }

  private leerGeometriaGuardada(): GeometriaGuardada | null {
    const store = this.storage();
    if (!store) return null;
    try {
      const raw = store.getItem(CLAVE_GEOMETRIA);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<GeometriaGuardada> | null;
      if (!parsed?.posicion || !parsed?.tamano) return null;
      return { posicion: parsed.posicion, tamano: parsed.tamano };
    } catch {
      return null;
    }
  }

  private guardarGeometria() {
    if (!this.recordarPosicion()) return;
    const store = this.storage();
    const pos = this.posicion();
    if (!store || !pos) return;
    try {
      store.setItem(CLAVE_GEOMETRIA, JSON.stringify({ posicion: pos, tamano: this.tamano() }));
    } catch {
      /* best-effort — no bloquea la ventana por un localStorage lleno/bloqueado */
    }
  }

  /** Posición/tamaño iniciales: guardados (si "recordar posición" está activo y hay
   *  algo guardado) o por defecto (esquina inferior derecha). Siempre clampeados al
   *  viewport ACTUAL (la pantalla pudo cambiar de tamaño desde la última sesión). */
  private inicializarGeometriaSiHaceFalta() {
    if (this.posicion()) return;
    const vp = this.viewport();
    const guardada = this.recordarPosicion() ? this.leerGeometriaGuardada() : null;
    const tamano = clamparTamano(guardada?.tamano ?? TAMANO_DEFECTO, vp);
    const posicion = guardada
      ? clamparPosicion(guardada.posicion, tamano, vp)
      : posicionPorDefecto(tamano, vp);
    this.tamano.set(tamano);
    this.posicion.set(posicion);
  }

  abrir() {
    this.montada.set(true);
    this.inicializarGeometriaSiHaceFalta();
    this.abierta.set(true);
    this.minimizada.set(false);
  }

  cerrar() {
    this.abierta.set(false);
  }

  toggleMinimizada() {
    this.minimizada.update((v) => !v);
  }

  /** "Anclar": vuelve a la esquina inferior derecha con el tamaño por defecto —
   *  la forma rápida de recuperar la ventana si quedó arrastrada/redimensionada a
   *  un lugar incómodo. Decisión propia (no especificado exactamente en la tarea). */
  anclar() {
    if (this.esMovil()) return;
    const vp = this.viewport();
    this.tamano.set(TAMANO_DEFECTO);
    this.posicion.set(posicionPorDefecto(TAMANO_DEFECTO, vp));
    this.guardarGeometria();
  }

  onViewportResize() {
    const pos = this.posicion();
    if (!pos || this.esMovil()) return;
    const vp = this.viewport();
    const tam = clamparTamano(this.tamano(), vp);
    this.tamano.set(tam);
    this.posicion.set(clamparPosicion(pos, tam, vp));
  }

  // ── Arrastre (barra superior) ──────────────────────────────────────────────
  private dragInicio: { punteroX: number; punteroY: number; posInicial: Punto } | null = null;

  onPointerDownBarra(e: PointerEvent) {
    if (this.esMovil()) return;
    // No arrastrar si el click cae en uno de los botones de la barra (anclar/min/cerrar).
    if ((e.target as HTMLElement).closest('button')) return;
    const pos = this.posicion();
    if (!pos) return;
    this.dragInicio = { punteroX: e.clientX, punteroY: e.clientY, posInicial: pos };
    this.arrastrando.set(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  onPointerMoveBarra(e: PointerEvent) {
    if (!this.arrastrando() || !this.dragInicio) return;
    const dx = e.clientX - this.dragInicio.punteroX;
    const dy = e.clientY - this.dragInicio.punteroY;
    const deseada: Punto = { x: this.dragInicio.posInicial.x + dx, y: this.dragInicio.posInicial.y + dy };
    this.posicion.set(clamparPosicion(deseada, this.tamano(), this.viewport()));
  }

  onPointerUpBarra() {
    if (!this.arrastrando()) return;
    this.arrastrando.set(false);
    this.dragInicio = null;
    this.guardarGeometria();
  }

  /** Alt + flechas, con el foco en la barra — mueve la ventana de a pasos (a11y). */
  onKeydownBarra(e: KeyboardEvent) {
    if (!e.altKey || !TECLAS_MOVIMIENTO.includes(e.key)) return;
    const pos = this.posicion();
    if (!pos || this.esMovil()) return;
    e.preventDefault();
    const nueva = moverConTeclado(pos, e.key as TeclaMovimiento);
    this.posicion.set(clamparPosicion(nueva, this.tamano(), this.viewport()));
    this.guardarGeometria();
  }

  // ── Redimensionar (esquina inferior derecha) ────────────────────────────────
  private resizeInicio: { punteroX: number; punteroY: number; tamInicial: Tamano } | null = null;

  onPointerDownResize(e: PointerEvent) {
    if (this.esMovil()) return;
    this.resizeInicio = { punteroX: e.clientX, punteroY: e.clientY, tamInicial: this.tamano() };
    this.redimensionando.set(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  onPointerMoveResize(e: PointerEvent) {
    if (!this.redimensionando() || !this.resizeInicio) return;
    const dx = e.clientX - this.resizeInicio.punteroX;
    const dy = e.clientY - this.resizeInicio.punteroY;
    const deseado: Tamano = { w: this.resizeInicio.tamInicial.w + dx, h: this.resizeInicio.tamInicial.h + dy };
    const vp = this.viewport();
    const nuevoTamano = clamparTamano(deseado, vp);
    this.tamano.set(nuevoTamano);
    const pos = this.posicion();
    if (pos) this.posicion.set(clamparPosicion(pos, nuevoTamano, vp));
  }

  onPointerUpResize() {
    if (!this.redimensionando()) return;
    this.redimensionando.set(false);
    this.resizeInicio = null;
    this.guardarGeometria();
  }
}
