import { Component, ChangeDetectionStrategy, ElementRef, inject, signal, computed, effect, OnInit, OnDestroy, DestroyRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from '../../../../shared/ui/icon/icon';
import { RichEditor, ImagenEditorConfig } from '../../../../shared/ui/rich-editor/rich-editor';
import { ActivatedRoute, Router } from '@angular/router';
import { NotasService, DirectorioUsuario } from '../../../../shared/services/notas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { FullscreenModeService } from '../../../../shared/services/fullscreen-mode.service';
import { Nota, NotaCompartido, NotaPermiso, NotaGrupo } from '../../../../shared/models/nota.model';
import { markdownAPlano } from '../../../../shared/utils/markdown-a-plano.util';
import { copiarImagenAlPortapapeles, descargarDesdeUrl } from '../../../../shared/utils/clipboard-imagen.util';
import { validarNombreGrupo, puedeMoverGrupo, puedeCrearSubgrupo } from '../../../../shared/utils/nota-grupos.util';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';

type Tab = 'mias' | 'compartidas';
type Ancho = 'comodo' | 'completo';

const HANDOFF_TPL = `# HANDOFF — <sesión>

**Fecha:** \n**Repo / versión:** \n

## Hecho
-

## Verificado
-

## Pendiente
-

## Decisiones
-
`;

const LS_ANCHO = 'sgc.devnotes.ancho';
const LS_LISTA_PLEGADA = 'sgc.devnotes.lista-plegada';
const LS_ULTIMA_ID = 'sgc.devnotes.ultima-id';
const AUTOSAVE_DEBOUNCE_MS = 2000;
// CS2 — grupos (carpetas anidadas) y vista "por mes y año".
const LS_GRUPOS_PLEGADOS = 'sgc.devnotes.grupos-plegados';
const LS_AGRUPAR_MES = 'sgc.devnotes.agrupar-mes';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

interface BucketLista {
  label: string;
  notas: Nota[];
  /** Si representa un grupo real (vs. un cubo de fecha como "Hoy"/"Octubre 2026"). */
  esGrupo?: boolean;
  grupo?: NotaGrupo;
  profundidad?: number;
  tieneHijos?: boolean;
  totalRecursivo?: number;
}

/** CV2 — fila editable en línea (crear/renombrar grupo), en vez de prompt(). */
interface GrupoEditando {
  modo: 'crear' | 'renombrar';
  /** Para 'crear': bajo qué padre (null = raíz). Para 'renombrar': el padre actual (informativo). */
  parentId: string | null;
  /** Para 'renombrar': el grupo que se edita. */
  grupoId: string | null;
  valor: string;
  error: string | null;
  /** CV3.3 — "Nuevo grupo con esta nota": al crear, mueve esta nota al grupo nuevo. */
  notaPendienteId?: string;
}

/** CV3 — qué se está arrastrando ahora mismo. */
type ArrastreActivo = { tipo: 'nota'; id: string } | { tipo: 'grupo'; id: string } | null;

// CV3.1 — tipos MIME propios para el arrastre HTML5 nativo (sin @angular/cdk).
const DT_NOTA = 'application/x-sgc-nota';
const DT_GRUPO = 'application/x-sgc-grupo';
const MS_AUTO_ABRIR_GRUPO = 600;

/** Días (locales, medianoche a medianoche) entre una fecha y hoy. 0 = hoy. */
function diasDesdeHoy(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const hoy = new Date();
  const dIni = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const hoyIni = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Math.round((hoyIni - dIni) / 86_400_000);
}

/**
 * BP5/CQ2 — "Dev notes": notas técnicas en Markdown (con bloques de código), personales
 * y compartidas, reutilizando sgc.notas (ambito='dev'). Gate por rol es_desarrollador.
 *
 * CQ2 añade: editor con formato real (TipTap, `app-rich-editor`) con un modo
 * "Texto simple" de respaldo (textarea monoespaciado), pantalla completa (oculta
 * el chrome del shell vía `FullscreenModeService`), autoguardado debounced,
 * Ctrl+N global (`DevNotesAtajosService`, en `app.ts`), Ctrl+\\ para plegar la
 * lista, selector de ancho, agrupación Hoy/Esta semana/Antes y "Mandar a ronda".
 */
@Component({
  selector: 'app-dev-notes',
  imports: [Icon, RichEditor, ConfirmDialog, NgTemplateOutlet],
  templateUrl: './dev-notes.html',
  styleUrl: './dev-notes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)', '(document:keydown.escape)': 'onDocEscape()' },
})
export class DevNotes implements OnInit, OnDestroy {
  private notasSvc = inject(NotasService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private host = inject(ElementRef<HTMLElement>);
  protected fullscreen = inject(FullscreenModeService);

  tab = signal<Tab>('mias');
  mias = signal<Nota[]>([]);
  compartidas = signal<Nota[]>([]);

  // ── CS2 — grupos (carpetas anidadas, tipo Notion) ───────────────────────────
  grupos = signal<NotaGrupo[]>([]);
  gruposPlegados = signal<Set<string>>(
    new Set(typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(LS_GRUPOS_PLEGADOS) || '[]') : []),
  );
  /** "Agrupar por mes y año" — solo reagrupa en pantalla lo que está en «Sin grupo»;
   *  no escribe datos. Una nota con grupo real se queda en su grupo. */
  agruparPorMes = signal(typeof localStorage !== 'undefined' && localStorage.getItem(LS_AGRUPAR_MES) === 'true');

  // ── CV2 — crear/renombrar grupo: fila editable en línea (reemplaza prompt()) ──
  grupoEditando = signal<GrupoEditando | null>(null);
  /** Resalta el grupo recién creado 2 s (CV2, sin animación si prefers-reduced-motion). */
  grupoResaltado = signal<string | null>(null);
  /** Eliminar grupo: confirm-dialog propio (reemplaza confirm() nativo). */
  grupoAEliminar = signal<NotaGrupo | null>(null);

  // ── CV3 — menú "⋯" (nota/grupo) y "Mover a…" ──────────────────────────────
  menuNotaAbierto = signal<string | null>(null);
  menuGrupoAbierto = signal<string | null>(null);
  /** Dentro del menú "⋯" de una nota: muestra la lista de destinos en vez del menú principal. */
  submenuMoverA = signal<string | null>(null);
  notaAEliminar = signal<Nota | null>(null);

  // ── CV3 — arrastre nativo (sin @angular/cdk) ──────────────────────────────
  arrastrando = signal<ArrastreActivo>(null);
  /** id de grupo | 'sin-grupo' | 'nuevo-grupo' sobre el que está encima ahora mismo. */
  destinoHover = signal<string | null>(null);
  private dragEnterCount = new Map<string, number>();
  private timerAutoAbrirGrupo: ReturnType<typeof setTimeout> | null = null;
  /** aria-live="polite" — anuncia el resultado del arrastre a lectores de pantalla. */
  liveRegionMsg = signal('');

  /** CV3 — ¿el grupo bajo el mouse acepta lo que se arrastra ahora? Las notas
   *  siempre caben; un grupo solo si no es a sí mismo/un descendiente/>4 niveles. */
  destinoGrupoValido = computed(() => {
    const d = this.arrastrando();
    const hover = this.destinoHover();
    if (!d || !hover || hover === 'sin-grupo' || hover === 'nuevo-grupo' || d.tipo !== 'grupo') return true;
    return puedeMoverGrupo(d.id, hover, this.grupos());
  });

  loading = signal(true);
  query = signal('');
  tagFiltro = signal<string | null>(null);

  // Nota abierta (copia de trabajo).
  activa = signal<Nota | null>(null);
  titulo = signal('');
  contenido = signal('');
  tags = signal<string[]>([]);
  nuevoTag = signal('');
  guardando = signal(false);
  private lastUpdatedAt: string | null = null;
  /** Snapshot de titulo+contenido+tags al abrir/guardar — el autoguardado solo
   *  dispara si el estado actual difiere de este (nunca autoguarda una nota
   *  recién abierta sin editar, ni una nota nueva vacía). */
  private baseline = '';

  // ── CQ2 — pantalla completa / layout ────────────────────────────────────
  listaPlegada = signal(typeof localStorage !== 'undefined' && localStorage.getItem(LS_LISTA_PLEGADA) === 'true');
  ancho = signal<Ancho>(
    (typeof localStorage !== 'undefined' ? (localStorage.getItem(LS_ANCHO) as Ancho | null) : null) ?? 'completo',
  );
  /** Modo "Texto simple": textarea monoespaciado sin formato (mismo Markdown subyacente). */
  modoSimple = signal(false);

  // ── CQ2 — autoguardado ───────────────────────────────────────────────────
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  guardadoEn = signal<number | null>(null);
  errorGuardado = signal<string | null>(null);
  private tick = signal(0);
  guardadoTexto = computed(() => {
    this.tick();
    const t = this.guardadoEn();
    if (t === null) return '';
    const segs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (segs < 2) return 'Guardado';
    if (segs < 60) return `Guardado hace ${segs} s`;
    const mins = Math.floor(segs / 60);
    if (mins < 60) return `Guardado hace ${mins} min`;
    return `Guardado hace ${Math.floor(mins / 60)} h`;
  });

  // ── Compartir (reutiliza el flujo de notas: mismo directorio + RPCs) ────────
  directorio = signal<DirectorioUsuario[]>([]);
  compartidos = signal<NotaCompartido[]>([]);
  compartirUsuario = signal<string | null>(null);
  compartirPermiso = signal<NotaPermiso>('ver');
  /** true cuando la nota abierta ya existe en BD (se puede compartir/mover). */
  persistida = signal(false);

  // ── CS2 — imágenes pegadas/arrastradas en el editor ─────────────────────────
  readonly imagenesConfig: ImagenEditorConfig = {
    subir: (file) => this.subirImagenEnNotaActiva(file),
    resolverUrl: (src) => this.notasSvc.resolverImagenNota(src),
    copiarAlPortapapeles: async (url) => {
      const res = await fetch(url);
      const blob = await res.blob();
      await copiarImagenAlPortapapeles(blob);
      this.toast.success('Imagen copiada', 'Ya la puedes pegar (Ctrl+V) en Claude Desktop, un correo, etc.');
    },
    descargar: (url, nombre) => descargarDesdeUrl(url, nombre),
    quitar: (src) => { void this.notasSvc.borrarImagenNota(src); },
  };

  /** CS2 — si la nota es nueva (nunca se guardó), guárdala primero: el bucket
   *  exige que la nota ya exista (RLS por nota_id). */
  private async subirImagenEnNotaActiva(file: File): Promise<string> {
    if (!this.activa()) throw new Error('No hay una nota abierta.');
    if (!this.persistida()) {
      await this.guardar();
      if (!this.persistida()) throw new Error('Guarda la nota antes de agregar imágenes.');
    }
    const n = this.activa();
    if (!n) throw new Error('No hay una nota abierta.');
    return this.notasSvc.subirImagenNota(n.id, n.owner_id, file);
  }

  soloLectura = computed(() => {
    const n = this.activa();
    const miId = this.userService.profile()?.id;
    return !!n && n.owner_id !== miId && n.mi_permiso === 'ver';
  });

  esOwner = computed(() => {
    const n = this.activa();
    const miId = this.userService.profile()?.id;
    return !!n && n.owner_id === miId;
  });

  /** Solo el dueño de una nota ya persistida puede compartirla / moverla. */
  puedeCompartir = computed(() => this.esOwner() && this.persistida());

  lista = computed(() => {
    const base = this.tab() === 'mias' ? this.mias() : this.compartidas();
    const q = this.query().trim().toLowerCase();
    const tag = this.tagFiltro();
    return base
      .filter((n) => !tag || (n.tags ?? []).includes(tag))
      .filter((n) => !q || (n.titulo + ' ' + n.contenido).toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
  });

  /** CS2 — grupos (del dueño) indexados por padre. */
  private gruposPorPadre = computed(() => {
    const m = new Map<string | null, NotaGrupo[]>();
    for (const g of this.grupos()) {
      const arr = m.get(g.parent_id);
      if (arr) arr.push(g);
      else m.set(g.parent_id, [g]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    return m;
  });
  /** Notas de `lista()` (ya filtradas por búsqueda/etiqueta) agrupadas por grupo_id. */
  private notasPorGrupoId = computed(() => {
    const m = new Map<string, Nota[]>();
    for (const n of this.lista()) {
      if (!n.grupo_id) continue;
      const arr = m.get(n.grupo_id);
      if (arr) arr.push(n);
      else m.set(n.grupo_id, [n]);
    }
    return m;
  });
  private sinGrupoNotas = computed(() => this.lista().filter((n) => !n.grupo_id));

  /** CS2 — cuenta recursiva de notas bajo un grupo (incluidos subgrupos), para el badge. */
  private contarNotasRecursivo(grupoId: string): number {
    let total = (this.notasPorGrupoId().get(grupoId) ?? []).length;
    for (const hijo of this.gruposPorPadre().get(grupoId) ?? []) total += this.contarNotasRecursivo(hijo.id);
    return total;
  }

  toggleGrupoPlegado(id: string) {
    this.gruposPlegados.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(LS_GRUPOS_PLEGADOS, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  toggleAgruparPorMes() {
    this.agruparPorMes.update((v) => {
      const nuevo = !v;
      try { localStorage.setItem(LS_AGRUPAR_MES, String(nuevo)); } catch { /* ignore */ }
      return nuevo;
    });
  }

  /** CQ2/CS2 — lista() agrupada: en «Mis notas», primero el árbol de grupos (con
   *  indentación), luego «Sin grupo» por Hoy/Semana/Antes (o por mes/año si el
   *  conmutador está activo). En «Compartidas conmigo», sin cambios (sin grupos). */
  agrupada = computed<BucketLista[]>(() => {
    if (this.tab() !== 'mias') return this.agruparPorFecha(this.lista());

    const out: BucketLista[] = [];
    const porGrupo = this.notasPorGrupoId();
    const plegados = this.gruposPlegados();
    const recorrer = (padreId: string | null, profundidad: number) => {
      for (const g of this.gruposPorPadre().get(padreId) ?? []) {
        const hijos = this.gruposPorPadre().get(g.id) ?? [];
        out.push({
          label: g.nombre, notas: porGrupo.get(g.id) ?? [], esGrupo: true, grupo: g,
          profundidad, tieneHijos: hijos.length > 0, totalRecursivo: this.contarNotasRecursivo(g.id),
        });
        if (!plegados.has(g.id)) recorrer(g.id, profundidad + 1);
      }
    };
    recorrer(null, 0);

    const sinGrupo = this.sinGrupoNotas();
    if (sinGrupo.length) {
      out.push(...(this.agruparPorMes() ? this.agruparPorMesAno(sinGrupo) : this.agruparPorFecha(sinGrupo)));
    }
    return out;
  });

  /** Hoy / Esta semana / Antes (comportamiento original). */
  private agruparPorFecha(notas: Nota[]): BucketLista[] {
    const hoy: Nota[] = [], semana: Nota[] = [], antes: Nota[] = [];
    for (const n of notas) {
      const dias = diasDesdeHoy(n.updated_at);
      if (dias <= 0) hoy.push(n);
      else if (dias <= 6) semana.push(n);
      else antes.push(n);
    }
    const out: BucketLista[] = [];
    if (hoy.length) out.push({ label: 'Hoy', notas: hoy });
    if (semana.length) out.push({ label: 'Esta semana', notas: semana });
    if (antes.length) out.push({ label: 'Antes', notas: antes });
    return out;
  }

  /** CS2 — "Agrupar por mes y año": no escribe datos, solo reagrupa en pantalla. */
  private agruparPorMesAno(notas: Nota[]): BucketLista[] {
    const byKey = new Map<string, Nota[]>();
    for (const n of notas) {
      const d = new Date(n.updated_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const arr = byKey.get(key);
      if (arr) arr.push(n);
      else byKey.set(key, [n]);
    }
    return [...byKey.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, notas]) => {
        const [y, m] = key.split('-').map(Number);
        return { label: `${MESES[m - 1]} ${y}`, notas };
      });
  }

  /** CS2 — opciones para el selector «Mover a…» de cada nota: árbol indentado + «Sin grupo». */
  opcionesMoverA = computed<{ id: string; label: string }[]>(() => {
    const out: { id: string; label: string }[] = [{ id: '', label: 'Sin grupo' }];
    const recorrer = (padreId: string | null, prefijo: string) => {
      for (const g of this.gruposPorPadre().get(padreId) ?? []) {
        out.push({ id: g.id, label: `${prefijo}${g.nombre}` });
        recorrer(g.id, prefijo + '— ');
      }
    };
    recorrer(null, '');
    return out;
  });

  /** CV3.5 — mueve una nota y avisa con "Deshacer" (un solo paso, restaura `grupo_id`). */
  async moverNotaAGrupoConAviso(nota: Nota, grupoId: string | null, nombreDestino: string) {
    const destino = grupoId || null;
    const anterior = nota.grupo_id ?? null;
    if (anterior === destino) return;
    try {
      await this.notasSvc.moverNotaAGrupo(nota.id, destino);
      const aplicar = (l: Nota[]) => l.map((x) => (x.id === nota.id ? { ...x, grupo_id: destino } : x));
      this.mias.update(aplicar);
      if (this.activa()?.id === nota.id) this.activa.update((a) => (a ? { ...a, grupo_id: destino } : a));
      this.liveRegionMsg.set(`Nota movida a «${nombreDestino}»`);
      this.toast.show(`Nota movida a «${nombreDestino}»`, {
        tipo: 'success',
        action: { label: 'Deshacer', handler: () => void this.deshacerMoverNota(nota.id, anterior) },
      });
    } catch (e) {
      // CV3 — si falla, la tarjeta ya se había "soltado" visualmente (drop); al no
      // tocarse mias()/activa() aquí, la UI refleja el grupo_id real (sin mover).
      this.toast.errorFrom(e, 'No se pudo mover la nota');
    }
  }

  /** Overload compatible con el menú "⋯" → "Mover a…" (resuelve el nombre del destino). */
  async moverNotaDesdeMenu(nota: Nota, grupoId: string) {
    const destino = grupoId || null;
    const nombre = destino ? (this.grupos().find((g) => g.id === destino)?.nombre ?? 'grupo') : 'Sin grupo';
    await this.moverNotaAGrupoConAviso(nota, destino, nombre);
  }

  private async deshacerMoverNota(notaId: string, grupoAnterior: string | null) {
    try {
      await this.notasSvc.moverNotaAGrupo(notaId, grupoAnterior);
      const aplicar = (l: Nota[]) => l.map((x) => (x.id === notaId ? { ...x, grupo_id: grupoAnterior } : x));
      this.mias.update(aplicar);
      if (this.activa()?.id === notaId) this.activa.update((a) => (a ? { ...a, grupo_id: grupoAnterior } : a));
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo deshacer');
    }
  }

  // ── CV2 — fila editable en línea: crear / renombrar ─────────────────────────
  /** `notaPendienteId` — CV3.3 "Nuevo grupo con esta nota": al crear, la mueve ahí. */
  abrirCrearGrupo(parentId: string | null, notaPendienteId?: string) {
    this.grupoEditando.set({ modo: 'crear', parentId, grupoId: null, valor: '', error: null, notaPendienteId });
    // La fila aparece debajo del padre, así que si estaba plegado, se abre primero.
    if (parentId && this.gruposPlegados().has(parentId)) this.toggleGrupoPlegado(parentId);
  }

  abrirRenombrarGrupo(g: NotaGrupo) {
    this.menuGrupoAbierto.set(null);
    this.grupoEditando.set({ modo: 'renombrar', parentId: g.parent_id, grupoId: g.id, valor: g.nombre, error: null });
  }

  onGrupoEditandoInput(valor: string) {
    this.grupoEditando.update((e) => (e ? { ...e, valor, error: null } : e));
  }

  onGrupoEditandoKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter') { ev.preventDefault(); void this.confirmarGrupoEditando(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); this.cancelarGrupoEditando(); }
  }

  /** CV2.3 — perder el foco con la fila vacía la cancela; con texto escrito se queda
   *  (un pequeño margen para que un click en "Crear"/"Cancelar" registre primero). */
  onGrupoEditandoBlur() {
    setTimeout(() => {
      const e = this.grupoEditando();
      if (e && !e.valor.trim()) this.grupoEditando.set(null);
    }, 150);
  }

  cancelarGrupoEditando() { this.grupoEditando.set(null); }

  async confirmarGrupoEditando() {
    const e = this.grupoEditando();
    if (!e) return;
    const nombre = e.valor.trim();
    if (!nombre) { this.grupoEditando.set(null); return; }
    const hermanos = (this.gruposPorPadre().get(e.parentId) ?? [])
      .filter((g) => g.id !== e.grupoId)
      .map((g) => g.nombre);
    const error = validarNombreGrupo(nombre, hermanos);
    if (error) { this.grupoEditando.update((cur) => (cur ? { ...cur, error } : cur)); return; }

    if (e.modo === 'crear') {
      const miId = this.userService.profile()?.id;
      if (!miId) return;
      try {
        const g = await this.notasSvc.crearGrupo(nombre, e.parentId, miId);
        this.grupos.update((l) => [...l, g]);
        this.grupoEditando.set(null);
        this.toast.success('Grupo creado');
        this.resaltarGrupo(g.id);
        if (e.notaPendienteId) {
          const nota = [...this.mias(), ...this.compartidas()].find((n) => n.id === e.notaPendienteId);
          if (nota) await this.moverNotaAGrupoConAviso(nota, g.id, g.nombre);
        }
      } catch (err) {
        this.grupoEditando.update((cur) => (cur ? { ...cur, error: this.mensajeErrorGrupo(err) } : cur));
      }
    } else {
      if (nombre === this.grupos().find((g) => g.id === e.grupoId)?.nombre) { this.grupoEditando.set(null); return; }
      try {
        await this.notasSvc.renombrarGrupo(e.grupoId!, nombre);
        this.grupos.update((l) => l.map((x) => (x.id === e.grupoId ? { ...x, nombre } : x)));
        this.grupoEditando.set(null);
      } catch (err) {
        this.grupoEditando.update((cur) => (cur ? { ...cur, error: this.mensajeErrorGrupo(err) } : cur));
      }
    }
  }

  /** CV2 — el trigger de BD sigue siendo la autoridad (ciclos/4 niveles); su mensaje
   *  ya viene en español, pero se homologa al texto exacto del diseño aprobado. */
  private mensajeErrorGrupo(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/4 niveles/i.test(msg)) return 'Los grupos admiten hasta 4 niveles.';
    if (/propio padre|dentro de s[ií] mismo o de un descendiente/i.test(msg)) return 'Un grupo no se puede meter dentro de sí mismo.';
    return 'No se pudo guardar el grupo. Inténtalo de nuevo.';
  }

  private resaltarGrupo(id: string) {
    this.grupoResaltado.set(id);
    setTimeout(() => this.grupoResaltado.update((cur) => (cur === id ? null : cur)), 2000);
    setTimeout(() => {
      const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this.host.nativeElement.querySelector(`[data-grupo-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' });
    }, 0);
  }

  /** `profundidad` ya viene de `agrupada()` (0 = raíz); "+" se apaga en el nivel 4. */
  puedeAgregarSubgrupo(g: NotaGrupo): boolean {
    return puedeCrearSubgrupo(g.id, this.grupos());
  }

  // ── CV2 — eliminar grupo (confirm-dialog en vez de confirm() nativo) ────────
  pedirEliminarGrupo(g: NotaGrupo) {
    this.menuGrupoAbierto.set(null);
    this.grupoAEliminar.set(g);
  }
  cancelarEliminarGrupo() { this.grupoAEliminar.set(null); }
  async confirmarEliminarGrupo() {
    const g = this.grupoAEliminar();
    if (!g) return;
    this.grupoAEliminar.set(null);
    try {
      await this.notasSvc.eliminarGrupo(g.id);
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo eliminar el grupo');
    }
  }

  // ── CV2 — mover un grupo a otro padre (desde el menú "⋯"; ver también CV3 arrastre) ──
  /** CV3.6 — opciones de "Mover a…" para un GRUPO, ya filtradas (ni a sí mismo,
   *  ni a un destino que violaría ciclos/4 niveles). */
  opcionesMoverGrupoValidas(g: NotaGrupo): { id: string; label: string }[] {
    return this.opcionesMoverA().filter((o) => o.id !== g.id && puedeMoverGrupo(g.id, o.id || null, this.grupos()));
  }

  async moverGrupoDesdeMenu(g: NotaGrupo, destinoId: string) {
    this.menuGrupoAbierto.set(null);
    const destino = destinoId || null;
    if ((g.parent_id ?? null) === destino) return;
    if (!puedeMoverGrupo(g.id, destino, this.grupos())) {
      this.toast.error('No se pudo mover el grupo', destino === g.id
        ? 'Un grupo no se puede meter dentro de sí mismo.'
        : 'Mover este grupo dejaría a un subgrupo con más de 4 niveles.');
      return;
    }
    try {
      await this.notasSvc.moverGrupo(g.id, destino);
      this.grupos.update((l) => l.map((x) => (x.id === g.id ? { ...x, parent_id: destino } : x)));
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo mover el grupo');
    }
  }

  // ── CV3 — menú "⋯" (nota) ────────────────────────────────────────────────────
  toggleMenuNota(notaId: string, ev: Event) {
    ev.stopPropagation();
    this.menuGrupoAbierto.set(null);
    this.submenuMoverA.set(null);
    this.menuNotaAbierto.update((cur) => (cur === notaId ? null : notaId));
  }
  abrirSubmenuMoverA(notaId: string, ev?: Event) {
    ev?.stopPropagation();
    this.submenuMoverA.set(notaId);
  }
  cerrarMenus() {
    this.menuNotaAbierto.set(null);
    this.menuGrupoAbierto.set(null);
    this.submenuMoverA.set(null);
  }
  async toggleFijarDesdeMenu(n: Nota) {
    this.cerrarMenus();
    try {
      await this.notasSvc.guardarNota(
        { id: n.id, titulo: n.titulo, contenido: n.contenido, color: n.color, pinned: !n.pinned, archivada: n.archivada, ambito: 'dev', formato: 'markdown', tags: n.tags ?? [] },
        n.updated_at,
      );
      const aplicar = (l: Nota[]) => l.map((x) => (x.id === n.id ? { ...x, pinned: !n.pinned } : x));
      this.mias.update(aplicar);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo fijar la nota');
    }
  }
  pedirEliminarNotaDesdeMenu(n: Nota) {
    this.cerrarMenus();
    this.notaAEliminar.set(n);
  }
  cancelarEliminarNota() { this.notaAEliminar.set(null); }
  async confirmarEliminarNotaDesdeMenu() {
    const n = this.notaAEliminar();
    if (!n) return;
    this.notaAEliminar.set(null);
    try {
      await this.notasSvc.eliminarNota(n.id);
      await this.recargar();
      this.toast.success('Nota eliminada');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo eliminar');
    }
  }

  // ── CV3 — menú "⋯" (grupo) ───────────────────────────────────────────────────
  toggleMenuGrupo(grupoId: string, ev: Event) {
    ev.stopPropagation();
    this.menuNotaAbierto.set(null);
    this.submenuMoverA.set(null);
    this.menuGrupoAbierto.update((cur) => (cur === grupoId ? null : grupoId));
  }

  /** Cierra cualquier menú abierto al hacer click fuera de él. */
  onDocClick(ev: MouseEvent) {
    const target = ev.target as Element;
    if (target.closest?.('.dn-menu, .dn-menu-trigger')) return;
    if (this.menuNotaAbierto() || this.menuGrupoAbierto() || this.submenuMoverA()) this.cerrarMenus();
  }

  /** Esc cierra el menú "⋯" abierto y devuelve el foco a su botón disparador. */
  onDocEscape() {
    const notaId = this.menuNotaAbierto();
    const grupoId = this.menuGrupoAbierto();
    if (!notaId && !grupoId) return;
    this.cerrarMenus();
    setTimeout(() => {
      const selector = notaId ? `[data-menu-nota="${notaId}"]` : `[data-menu-grupo="${grupoId}"]`;
      (this.host.nativeElement.querySelector(selector) as HTMLElement | null)?.focus();
    }, 0);
  }

  // ── CV3 — arrastre HTML5 nativo (sin @angular/cdk) ───────────────────────────
  onNotaDragStart(nota: Nota, ev: DragEvent) {
    this.cerrarMenus();
    this.arrastrando.set({ tipo: 'nota', id: nota.id });
    ev.dataTransfer?.setData(DT_NOTA, nota.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  onGrupoDragStart(g: NotaGrupo, ev: DragEvent) {
    this.cerrarMenus();
    this.arrastrando.set({ tipo: 'grupo', id: g.id });
    ev.dataTransfer?.setData(DT_GRUPO, g.id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  onDragEnd() {
    this.arrastrando.set(null);
    this.destinoHover.set(null);
    this.dragEnterCount.clear();
    this.cancelarAutoAbrirGrupo();
  }

  onZoneDragOver(ev: DragEvent) {
    if (!this.arrastrando()) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  }
  /** `zoneId`: id de grupo real, 'sin-grupo' o 'nuevo-grupo'. Contador de
   *  entradas/salidas (CV3.1) para no parpadear con hijos del mismo elemento. */
  onZoneDragEnter(zoneId: string, ev: DragEvent) {
    if (!this.arrastrando()) return;
    ev.preventDefault();
    this.dragEnterCount.set(zoneId, (this.dragEnterCount.get(zoneId) ?? 0) + 1);
    this.destinoHover.set(zoneId);
    this.evaluarAutoAbrirGrupo(zoneId);
  }
  onZoneDragLeave(zoneId: string) {
    const n = Math.max(0, (this.dragEnterCount.get(zoneId) ?? 1) - 1);
    this.dragEnterCount.set(zoneId, n);
    if (n === 0 && this.destinoHover() === zoneId) {
      this.destinoHover.set(null);
      this.cancelarAutoAbrirGrupo();
    }
  }
  /** CV3.3 — grupo cerrado con subgrupos: se abre solo tras 600 ms encima. */
  private evaluarAutoAbrirGrupo(zoneId: string) {
    this.cancelarAutoAbrirGrupo();
    if (!this.gruposPlegados().has(zoneId)) return;
    const tieneHijos = (this.gruposPorPadre().get(zoneId) ?? []).length > 0;
    if (!tieneHijos) return;
    this.timerAutoAbrirGrupo = setTimeout(() => {
      if (this.destinoHover() === zoneId) this.toggleGrupoPlegado(zoneId);
    }, MS_AUTO_ABRIR_GRUPO);
  }
  private cancelarAutoAbrirGrupo() {
    if (this.timerAutoAbrirGrupo) { clearTimeout(this.timerAutoAbrirGrupo); this.timerAutoAbrirGrupo = null; }
  }

  async onZoneDrop(zoneId: string, ev: DragEvent) {
    ev.preventDefault();
    this.dragEnterCount.set(zoneId, 0);
    this.destinoHover.set(null);
    this.cancelarAutoAbrirGrupo();
    const d = this.arrastrando();
    this.arrastrando.set(null);
    if (!d) return;

    // CV3.3 — "Nuevo grupo con esta nota": abre la fila de crear con la nota pendiente.
    if (zoneId === 'nuevo-grupo') {
      if (d.tipo === 'nota') this.abrirCrearGrupo(null, d.id);
      return;
    }
    const destinoId = zoneId === 'sin-grupo' ? null : zoneId;

    if (d.tipo === 'nota') {
      const nota = [...this.mias(), ...this.compartidas()].find((n) => n.id === d.id);
      if (!nota) return;
      const nombreDestino = destinoId ? (this.grupos().find((g) => g.id === destinoId)?.nombre ?? 'grupo') : 'Sin grupo';
      await this.moverNotaAGrupoConAviso(nota, destinoId, nombreDestino);
      return;
    }

    // Arrastrando un grupo (sobre otro grupo = subgrupo; sobre "Sin grupo" = raíz).
    if (!puedeMoverGrupo(d.id, destinoId, this.grupos())) {
      this.toast.error('No se pudo mover el grupo', destinoId === d.id
        ? 'Un grupo no se puede meter dentro de sí mismo.'
        : 'Mover este grupo dejaría a un subgrupo con más de 4 niveles.');
      return;
    }
    try {
      await this.notasSvc.moverGrupo(d.id, destinoId);
      this.grupos.update((l) => l.map((x) => (x.id === d.id ? { ...x, parent_id: destinoId } : x)));
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo mover el grupo');
    }
  }

  /** Conteo de palabras del contenido (pie del editor, como en el mock). */
  palabras = computed(() => {
    const m = this.contenido().trim().match(/\S+/g);
    return m ? m.length : 0;
  });

  tagsDisponibles = computed(() => {
    const set = new Set<string>();
    for (const n of [...this.mias(), ...this.compartidas()]) (n.tags ?? []).forEach((t) => set.add(t));
    return [...set].sort();
  });

  constructor() {
    // CQ2 — pantalla completa mientras haya una nota abierta.
    effect(() => {
      if (this.activa()) this.fullscreen.activar();
      else this.fullscreen.desactivar();
    });

    // CQ2 — autoguardado: debounce 2s desde el último cambio REAL (vs. baseline).
    effect(() => {
      const n = this.activa();
      const snap = this.snapshot();
      if (!n || this.soloLectura() || snap === this.baseline) return;
      if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
      this.autosaveTimer = setTimeout(() => void this.autoguardar(), AUTOSAVE_DEBOUNCE_MS);
    });

    // "Guardado hace Xs" — recalcula cada segundo mientras haya un guardado reciente.
    this.tickInterval = setInterval(() => this.tick.update((v) => v + 1), 1000);

    // CV2 — la fila de crear/renombrar grupo aparece con el cursor ya escribiendo.
    effect(() => {
      if (!this.grupoEditando()) return;
      setTimeout(() => {
        const input = this.host.nativeElement.querySelector('.dn-grupo-edit__row input') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    });
  }

  async ngOnInit() {
    // BR — dev notes solo se comparten con desarrolladores (Tecnología/programación).
    this.notasSvc.getDirectorioDesarrolladores().then((d) => this.directorio.set(d)).catch(() => {});

    // Ctrl+N (DevNotesAtajosService) navega aquí con ?nueva=1; reactivo porque si
    // ya estamos en /tecnologia/dev-notes, Angular reutiliza el componente (no
    // vuelve a correr ngOnInit) y solo cambian los queryParams.
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params['nueva'] === '1') {
        this.nueva();
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      }
    });

    await this.recargar();
    if (!this.activa()) this.abrirUltimaOInicial();

    // Ctrl+\\ (plegar/expandir lista) — solo mientras esta pantalla está montada.
    document.addEventListener('keydown', this.onAtajoTeclado);
  }

  ngOnDestroy() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.tickInterval) clearInterval(this.tickInterval);
    document.removeEventListener('keydown', this.onAtajoTeclado);
    this.fullscreen.desactivar();
  }

  private snapshot(): string {
    return JSON.stringify({ t: this.titulo(), c: this.contenido(), tags: this.tags() });
  }

  private async recargar() {
    this.loading.set(true);
    const miId = this.userService.profile()?.id;
    if (!miId) { this.loading.set(false); return; }
    try {
      const [mias, comp, grupos] = await Promise.all([
        this.notasSvc.getMisNotas(miId, true, 'dev'),
        this.notasSvc.getCompartidasConmigo(miId, 'dev'),
        this.notasSvc.getGrupos(),
      ]);
      this.mias.set(mias);
      this.compartidas.set(comp);
      this.grupos.set(grupos);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudieron cargar las notas');
    } finally {
      this.loading.set(false);
    }
  }

  /** CQ2 — abre la última nota editada (updated_at) al entrar sin querystring;
   *  respaldo por el último id abierto en localStorage si `mias()` está vacío. */
  private abrirUltimaOInicial() {
    const idGuardado = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_ULTIMA_ID) : null;
    const todas = [...this.mias(), ...this.compartidas()];
    const porId = idGuardado ? todas.find((n) => n.id === idGuardado) : undefined;
    const masReciente = [...this.mias()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const elegido = porId ?? masReciente;
    if (elegido) this.abrir(elegido);
  }

  abrir(n: Nota) {
    this.activa.set(n);
    this.titulo.set(n.titulo ?? '');
    this.contenido.set(n.contenido ?? '');
    this.tags.set([...(n.tags ?? [])]);
    this.lastUpdatedAt = n.updated_at;
    this.persistida.set(true);
    this.compartirUsuario.set(null);
    this.compartidos.set([]);
    this.guardadoEn.set(null);
    this.errorGuardado.set(null);
    this.baseline = this.snapshot();
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_ULTIMA_ID, n.id);
    void this.cargarCompartidos(n.id);
  }

  nueva() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const miId = this.userService.profile()?.id ?? '';
    const n: Nota = {
      id, owner_id: miId, titulo: '', contenido: '', color: null, pinned: false,
      archivada: false, created_at: now, updated_at: now, ambito: 'dev', formato: 'markdown', tags: [],
    };
    this.activa.set(n);
    this.titulo.set('');
    this.contenido.set('');
    this.tags.set([]);
    this.lastUpdatedAt = null;
    this.persistida.set(false);
    this.compartidos.set([]);
    this.compartirUsuario.set(null);
    this.guardadoEn.set(null);
    this.errorGuardado.set(null);
    this.baseline = this.snapshot();
  }

  async cerrarEditor() {
    if (this.autosaveTimer) { clearTimeout(this.autosaveTimer); this.autosaveTimer = null; }
    const n = this.activa();
    // CS3 — si hay cambios sin guardar (incl. una nota nueva que nunca llegó a
    // autoguardarse por el debounce), guárdalos antes de cerrar: si no, se pierden.
    if (n && !this.soloLectura() && this.snapshot() !== this.baseline) {
      await this.autoguardar();
    }
    this.activa.set(null);
    await this.recargar();
  }

  addTag() {
    const t = this.nuevoTag().trim().toLowerCase();
    if (t && !this.tags().includes(t)) this.tags.update((l) => [...l, t]);
    this.nuevoTag.set('');
  }
  quitarTag(t: string) { this.tags.update((l) => l.filter((x) => x !== t)); }

  insertarPlantilla() { this.contenido.set(this.contenido() + (this.contenido() ? '\n\n' : '') + HANDOFF_TPL); }

  async guardar() {
    const n = this.activa();
    if (!n || this.soloLectura() || this.guardando()) return;
    this.guardando.set(true);
    if (this.autosaveTimer) { clearTimeout(this.autosaveTimer); this.autosaveTimer = null; }
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id: n.id, titulo: this.titulo().trim(), contenido: this.contenido(),
          color: n.color, pinned: n.pinned, archivada: n.archivada,
          ambito: 'dev', formato: 'markdown', tags: this.tags(),
        },
        this.lastUpdatedAt,
      );
      this.lastUpdatedAt = res.nota.updated_at;
      this.activa.set(res.nota);
      this.persistida.set(true);
      this.baseline = this.snapshot();
      this.guardadoEn.set(Date.now());
      this.errorGuardado.set(null);
      if (res.conflict) this.toast.info('Guardado', 'Otro editó esta nota antes; se conservó tu versión.');
      else this.toast.success('Guardado');
      await this.recargar();
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    } finally {
      this.guardando.set(false);
    }
  }

  /** CQ2 — autoguardado silencioso (sin toast ni recarga de lista en cada tick;
   *  solo actualiza la entrada local para que el preview de la lista no quede
   *  desfasado). Un error SÍ se muestra (regla: nunca fallar en silencio). */
  private async autoguardar() {
    const n = this.activa();
    if (!n || this.soloLectura()) return;
    try {
      const res = await this.notasSvc.guardarNota(
        {
          id: n.id, titulo: this.titulo().trim(), contenido: this.contenido(),
          color: n.color, pinned: n.pinned, archivada: n.archivada,
          ambito: 'dev', formato: 'markdown', tags: this.tags(),
        },
        this.lastUpdatedAt,
      );
      this.lastUpdatedAt = res.nota.updated_at;
      this.activa.set(res.nota);
      this.persistida.set(true);
      this.baseline = this.snapshot();
      this.guardadoEn.set(Date.now());
      this.errorGuardado.set(null);
      this.actualizarEnListaLocal(res.nota);
    } catch (e: unknown) {
      this.errorGuardado.set('No se pudo guardar automáticamente. Revisa tu conexión.');
      this.toast.errorFrom(e, 'Autoguardado falló');
    }
  }

  /** Refleja una nota recién guardada en mias()/compartidas() sin refetch. CS3 —
   *  si es una nota NUEVA (el primer autoguardado), no está todavía en la lista:
   *  hay que agregarla, no solo reemplazar. */
  private actualizarEnListaLocal(nota: Nota) {
    const miId = this.userService.profile()?.id ?? '';
    const upsert = (lista: Nota[]): Nota[] => {
      const i = lista.findIndex((x) => x.id === nota.id);
      if (i === -1) return [{ ...nota }, ...lista];
      const copia = [...lista];
      copia[i] = { ...copia[i], ...nota };
      return copia;
    };
    if (nota.owner_id === miId) this.mias.update(upsert);
    else this.compartidas.update(upsert);
  }

  async eliminar() {
    const n = this.activa();
    if (!n) return;
    try {
      await this.notasSvc.eliminarNota(n.id);
      this.activa.set(null);
      await this.recargar();
      this.toast.success('Nota eliminada');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo eliminar');
    }
  }

  async togglePin() {
    const n = this.activa();
    if (!n) return;
    n.pinned = !n.pinned;
    this.activa.set({ ...n });
    await this.guardar();
  }

  // ── CQ2 — layout: pantalla completa / lista plegable / ancho ────────────────
  toggleListaPlegada() {
    this.listaPlegada.update((v) => {
      const next = !v;
      if (typeof localStorage !== 'undefined') localStorage.setItem(LS_LISTA_PLEGADA, String(next));
      return next;
    });
  }

  ciclarAncho() {
    this.ancho.update((v) => {
      const next: Ancho = v === 'completo' ? 'comodo' : 'completo';
      if (typeof localStorage !== 'undefined') localStorage.setItem(LS_ANCHO, next);
      return next;
    });
  }

  toggleModoSimple() {
    this.modoSimple.update((v) => !v);
  }

  /** Ctrl+\\ (plegar/expandir lista). Escucha solo mientras esta pantalla está montada. */
  private onAtajoTeclado = (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === '\\') {
      ev.preventDefault();
      this.toggleListaPlegada();
    }
  };

  // ── CQ2 — "Mandar a ronda" ───────────────────────────────────────────────
  async mandarARonda() {
    const n = this.activa();
    if (!n) return;
    const texto = markdownAPlano(this.contenido());
    const cuerpo = this.titulo().trim() ? `${this.titulo().trim()}\n\n${texto}` : texto;
    try {
      await navigator.clipboard.writeText(cuerpo);
    } catch {
      this.toast.error('No se pudo copiar', 'El navegador bloqueó el acceso al portapapeles.');
      return;
    }
    this.toast.success('Copiado', 'Pega el contenido en la conversación de la ronda.');
    if (this.persistida()) {
      try {
        const enviadaEn = await this.notasSvc.marcarEnviadaARonda(n.id);
        this.activa.update((cur) => (cur ? { ...cur, enviada_a_ronda_at: enviadaEn } : cur));
      } catch {
        // No bloquea la copia si falla marcar "enviada" — es solo informativo.
      }
    }
  }

  // ── Exportar / importar ─────────────────────────────────────────────────
  /** CS2 — una imagen pegada nunca sale como ruta interna rota al exportar. */
  private sinImagenesDeNota(markdown: string): string {
    return markdown.replace(/!\[([^\]]*)\]\(nota-img:[^)]+\)/g, (_m, alt: string) =>
      alt.trim() ? `[imagen no incluida: ${alt.trim()}]` : '[imagen no incluida]');
  }

  exportarMd() {
    const nombre = (this.titulo().trim() || 'dev-note').replace(/[^\w.-]+/g, '-');
    const blob = new Blob([this.sinImagenesDeNota(this.contenido())], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** CQ2 — .txt: mismo contenido convertido a texto plano legible (como "Mandar a ronda"). */
  exportarTxt() {
    const nombre = (this.titulo().trim() || 'dev-note').replace(/[^\w.-]+/g, '-');
    const blob = new Blob([markdownAPlano(this.contenido())], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importarMd(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const texto = await file.text();
    if (!this.activa()) this.nueva();
    if (!this.titulo().trim()) this.titulo.set(file.name.replace(/\.(md|txt)$/i, ''));
    this.contenido.set(this.contenido() ? this.contenido() + '\n\n' + texto : texto);
    input.value = '';
  }

  // ── Compartir (mismo flujo que /notas; la RLS 'dev' limita la visibilidad a
  //    Tecnología aunque se comparta con alguien que no lo sea) ────────────────
  private async cargarCompartidos(notaId: string) {
    try {
      this.compartidos.set(await this.notasSvc.getCompartidos(notaId));
    } catch {
      this.compartidos.set([]); // solo el dueño puede leerlos
    }
  }

  async agregarCompartido() {
    const usuarioId = this.compartirUsuario();
    const n = this.activa();
    if (!usuarioId || !n || !this.puedeCompartir()) return;
    try {
      await this.notasSvc.compartir(n.id, usuarioId, this.compartirPermiso());
      this.compartirUsuario.set(null);
      await this.cargarCompartidos(n.id);
      this.toast.success('Nota compartida');
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo compartir');
    }
  }

  async cambiarPermiso(c: NotaCompartido, permiso: NotaPermiso) {
    const n = this.activa();
    if (!n || c.permiso === permiso) return;
    try {
      await this.notasSvc.cambiarPermiso(n.id, c.usuario_id, permiso);
      await this.cargarCompartidos(n.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo cambiar el permiso');
    }
  }

  async quitarCompartido(c: NotaCompartido) {
    const n = this.activa();
    if (!n) return;
    try {
      await this.notasSvc.quitarCompartido(n.id, c.usuario_id);
      await this.cargarCompartidos(n.id);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo quitar el acceso');
    }
  }

  // ── BP5 — mover de vuelta a /notas (ambito='general') ──────────────────────
  async moverANotas() {
    const n = this.activa();
    if (!n || !this.puedeCompartir() || this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.notasSvc.guardarNota(
        {
          id: n.id, titulo: this.titulo().trim(), contenido: this.contenido(),
          color: n.color, pinned: n.pinned, archivada: n.archivada,
          ambito: 'general', formato: 'markdown', tags: this.tags(),
        },
        this.lastUpdatedAt,
      );
      this.toast.success('Movida a Notas');
      this.router.navigate(['/notas']);
    } catch (e: unknown) {
      this.toast.errorFrom(e, 'No se pudo mover a Notas');
    } finally {
      this.guardando.set(false);
    }
  }
}
