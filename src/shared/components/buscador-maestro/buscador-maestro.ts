import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { I18nService } from '../../i18n/i18n.service';
import { IndiceMenuEntry } from '../shell/menu-index.util';
import { buscarEnIndice, normalizarTexto, ResultadoBusqueda } from './buscador-coincidencia.util';
import { cargarRecientesIds, guardarRecienteId } from './recientes.util';

/** Una fila pintable del diálogo (resultado real, reciente o sugerencia — las dos
 *  últimas no tienen rangos que resaltar). */
export interface FilaBuscador {
  entrada: IndiceMenuEntry;
  resaltar: Array<[number, number]>;
}

export interface SeccionBuscador {
  titulo: string;
  filas: FilaBuscador[];
}

/** Candidatas a "también podrías buscar": pantallas de uso frecuente, en orden de
 *  prioridad. Se filtran contra el índice real del usuario (solo las que puede ver,
 *  y solo las que existen) — nunca se inventa una sugerencia fuera del índice. */
const RUTAS_SUGERIDAS_POR_DEFECTO = [
  '/dashboard',
  '/tareas/mis-tareas',
  '/mensajes',
  '/notas',
  '/configuracion',
  '/inventario/conduces',
  '/flota/vehiculos',
  '/bitacora/nueva',
  '/soporte',
];

function sinResaltar(entrada: IndiceMenuEntry): FilaBuscador {
  return { entrada, resaltar: [] };
}

/**
 * Navegación circular por teclado (↑/↓): puro, sin estado — fácil de probar sin
 * montar el componente. `total === 0` no mueve nada (evita división por cero).
 */
export function calcularSiguienteIndice(total: number, actual: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (actual + delta + total) % total;
}

/**
 * DG — Buscador maestro (Ctrl+K). Overlay de navegación por módulos/pantallas, NO
 * busca folios/personas/obras (eso queda fuera de alcance — ver HANDOFF). Patrón
 * ARIA "combobox con listbox": el único elemento realmente enfocable es el campo de
 * texto; las filas son `role="option"` marcadas por `aria-activedescendant` (así el
 * foco queda naturalmente "atrapado" sin necesitar gestionar Tab entre varias filas).
 */
@Component({
  selector: 'app-buscador-maestro',
  imports: [TranslatePipe],
  templateUrl: './buscador-maestro.html',
  styleUrl: './buscador-maestro.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class BuscadorMaestro {
  private router = inject(Router);
  private i18n = inject(I18nService);

  /** Controlado por el shell (Ctrl+K / lupa / "/"). */
  abierto = input<boolean>(false);
  /** Índice ÚNICO del menú (ya filtrado por permisos) — ver `menu-index.util.ts`. */
  indice = input<IndiceMenuEntry[]>([]);
  cerrado = output<void>();

  campoInput = viewChild<ElementRef<HTMLInputElement>>('campoInput');

  query = signal('');
  seleccionIndex = signal(0);
  private recientesIds = signal<string[]>([]);
  private elementoPrevio: HTMLElement | null = null;

  private storage(): Storage | undefined {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
      return undefined;
    }
  }

  hayTexto = computed(() => normalizarTexto(this.query()).length > 0);

  private resultados = computed<ResultadoBusqueda[]>(() => {
    const q = this.query();
    if (!normalizarTexto(q)) return [];
    return buscarEnIndice(q, this.indice(), 9);
  });

  private recientesResueltos = computed<IndiceMenuEntry[]>(() => {
    const porRuta = new Map(this.indice().map((e) => [e.ruta, e]));
    return this.recientesIds()
      .map((ruta) => porRuta.get(ruta))
      .filter((e): e is IndiceMenuEntry => !!e);
  });

  private sugerenciasResueltas(excluirIds: Set<string>): IndiceMenuEntry[] {
    const porRuta = new Map(this.indice().map((e) => [e.ruta, e]));
    const out: IndiceMenuEntry[] = [];
    for (const ruta of RUTAS_SUGERIDAS_POR_DEFECTO) {
      const e = porRuta.get(ruta);
      if (e && !excluirIds.has(e.id)) out.push(e);
      if (out.length >= 3) break;
    }
    return out;
  }

  /** Secciones a pintar, ya agrupadas y traducidas. Fuente única para el template Y
   *  para la navegación por teclado (`opcionesPlano`). */
  secciones = computed<SeccionBuscador[]>(() => {
    const secciones: SeccionBuscador[] = [];

    if (!this.hayTexto()) {
      const recientes = this.recientesResueltos();
      if (recientes.length) {
        secciones.push({ titulo: this.i18n.t('Recientes'), filas: recientes.map(sinResaltar) });
      }
      const sugeridas = this.sugerenciasResueltas(new Set(recientes.map((e) => e.id)));
      if (sugeridas.length) {
        secciones.push({
          titulo: this.i18n.t('También podrías buscar'),
          filas: sugeridas.map(sinResaltar),
        });
      }
      return secciones;
    }

    const resultados = this.resultados();
    const pantallas = resultados.filter((r) => !r.entrada.esModulo);
    const modulos = resultados.filter((r) => r.entrada.esModulo);
    if (pantallas.length) {
      secciones.push({
        titulo: this.i18n.t('Pantallas'),
        filas: pantallas.map((r) => ({ entrada: r.entrada, resaltar: r.resaltar })),
      });
    }
    if (modulos.length) {
      secciones.push({
        titulo: this.i18n.t('Módulos'),
        filas: modulos.map((r) => ({ entrada: r.entrada, resaltar: r.resaltar })),
      });
    }
    if (resultados.length < 3) {
      const sugeridas = this.sugerenciasResueltas(new Set(resultados.map((r) => r.entrada.id)));
      if (sugeridas.length) {
        secciones.push({
          titulo: this.i18n.t('También podrías buscar'),
          filas: sugeridas.map(sinResaltar),
        });
      }
    }
    return secciones;
  });

  /** true cuando hay texto escrito pero ningún resultado real (solo sugerencias, si
   *  las hay) — dispara el mensaje "No encontré eso…". */
  sinResultados = computed(() => this.hayTexto() && this.resultados().length === 0);

  /** Todas las filas, en el orden en que se pintan — para mover la selección con
   *  flechas sin importar en qué sección cae cada una. */
  opcionesPlano = computed<FilaBuscador[]>(() => this.secciones().flatMap((s) => s.filas));

  anuncio = computed(() => {
    if (!this.abierto()) return '';
    if (!this.hayTexto()) return '';
    const n = this.opcionesPlano().length;
    return this.i18n.t('{n} resultados', { n });
  });

  /** Parte `fila.entrada.camino` en segmentos para pintar `<mark>` solo donde hizo
   *  match (`resaltar`, en índices sobre el texto normalizado — misma longitud que
   *  el original, así que los índices aplican igual). */
  segmentosCamino(fila: FilaBuscador): { texto: string; marcado: boolean }[] {
    const camino = fila.entrada.camino;
    const rangos = fila.resaltar;
    if (!rangos.length) return [{ texto: camino, marcado: false }];
    const segmentos: { texto: string; marcado: boolean }[] = [];
    let cursor = 0;
    for (const [inicio, fin] of rangos) {
      if (inicio < cursor || inicio >= camino.length) continue;
      if (inicio > cursor) segmentos.push({ texto: camino.slice(cursor, inicio), marcado: false });
      segmentos.push({ texto: camino.slice(inicio, fin), marcado: true });
      cursor = fin;
    }
    if (cursor < camino.length) segmentos.push({ texto: camino.slice(cursor), marcado: false });
    return segmentos;
  }

  seleccionId(i: number): string {
    return `buscador-opcion-${i}`;
  }

  /** Índice global de una fila dentro de `opcionesPlano()` (misma referencia de
   *  objeto, gracias a la memoización de los `computed`). Usado para resaltar la
   *  fila activa y para `aria-selected`/`aria-activedescendant`. */
  indiceDe(fila: FilaBuscador): number {
    return this.opcionesPlano().indexOf(fila);
  }

  activeDescendant = computed(() => {
    const total = this.opcionesPlano().length;
    if (!total) return null;
    return this.seleccionId(Math.min(this.seleccionIndex(), total - 1));
  });

  constructor() {
    // Al abrir: recarga recientes, limpia el campo, enfoca el input y recuerda qué
    // tenía el foco para devolverlo al cerrar. Al cerrar: devuelve el foco.
    effect(() => {
      const abierto = this.abierto();
      if (abierto) {
        untracked(() => {
          this.elementoPrevio = (document.activeElement as HTMLElement) ?? null;
          this.recientesIds.set(cargarRecientesIds(this.storage()));
          this.query.set('');
          this.seleccionIndex.set(0);
        });
        queueMicrotask(() => this.campoInput()?.nativeElement.focus());
      } else {
        untracked(() => {
          this.elementoPrevio?.focus?.();
          this.elementoPrevio = null;
        });
      }
    });
  }

  onQueryChange(valor: string) {
    this.query.set(valor);
    this.seleccionIndex.set(0);
  }

  moverSeleccion(delta: 1 | -1) {
    const total = this.opcionesPlano().length;
    if (!total) return;
    this.seleccionIndex.update((i) => calcularSiguienteIndice(total, i, delta));
  }

  elegir(fila: FilaBuscador) {
    this.recientesIds.set(guardarRecienteId(this.storage(), fila.entrada.ruta));
    this.router.navigateByUrl(fila.entrada.ruta);
    this.cerrar();
  }

  elegirSeleccionActual() {
    const fila = this.opcionesPlano()[this.seleccionIndex()];
    if (fila) this.elegir(fila);
  }

  cerrar() {
    this.cerrado.emit();
  }

  onBackdropClick() {
    this.cerrar();
  }

  onKeydown(e: KeyboardEvent) {
    if (!this.abierto()) return;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.cerrar();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moverSeleccion(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moverSeleccion(-1);
        break;
      case 'Enter':
        e.preventDefault();
        this.elegirSeleccionActual();
        break;
      case 'Tab':
        // DG — único elemento enfocable del diálogo es el campo de texto: no hay a
        // dónde "saltar" dentro del overlay, así que el foco queda atrapado sin más.
        e.preventDefault();
        break;
    }
  }
}
