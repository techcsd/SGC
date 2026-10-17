import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { Editor, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

/**
 * Mismas extensiones que usa `<app-rich-editor>`, exportadas para que el test
 * de ida y vuelta Markdown↔TipTap (`markdown-roundtrip.spec.ts`) ejercite
 * EXACTAMENTE el mismo editor que corre en pantalla (sin duplicar la lista y
 * arriesgar que diverjan).
 */
export function extensionesNotasRicas(): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Underline,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: false }),
    Link.configure({ openOnClick: false, autolink: true }),
    Markdown.configure({
      html: false, // seguridad: el contenido se comparte entre usuarios (compartir_nota)
      tightLists: true,
      bulletListMarker: '-',
      linkify: true,
      breaks: true, // paridad con el preview viejo (marked breaks:true) para notas ya escritas
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ];
}

/**
 * CQ2 — Workaround de un bug real de `tiptap-markdown` (vía `markdown-it-task-lists`):
 * cuando el Markdown fuente tiene una lista con viñetas normal SEGUIDA (sin marcador
 * distinto) de ítems con casilla `- [ ]` dentro del MISMO bloque de lista (CommonMark
 * los fusiona en un solo `<ul>` porque comparten marcador `-`, aunque haya una línea en
 * blanco entre medio), el `<ul>` completo queda marcado `contains-task-list` aunque solo
 * ALGUNOS `<li>` sean casillas. El parser de ProseMirror, al toparse con un `<li>` sin
 * casilla donde espera `taskItem`, no puede ubicarlo — y como mecanismo de recuperación
 * cierra un `taskList` FANTASMA con un único `taskItem` vacío ANTES del `bulletList` real
 * (confirmado inspeccionando `editor.getJSON()`: aparece
 * `[taskList(taskItem vacío), bulletList(los ítems reales), taskList(la casilla real)]`
 * en vez de los dos nodos esperados). No pierde texto (el `taskItem` fantasma está
 * vacío), pero deja una casilla vacía espuria visible al abrir la nota.
 *
 * Esta función repara la firma EXACTA del artefacto (un `taskList` de un solo
 * `taskItem` totalmente vacío, inmediatamente antes de una lista real) justo después de
 * parsear Markdown→doc. No se ejecuta en cada tecleo (solo tras `setContent`), así que
 * NUNCA borra una casilla vacía que el usuario acaba de insertar desde el menú "/" para
 * escribir en ella.
 */
export function repararListaFantasma(editor: Editor): void {
  const { doc } = editor.state;
  const hijos: { node: import('@tiptap/pm/model').Node; pos: number }[] = [];
  doc.forEach((node, offset) => hijos.push({ node, pos: offset }));

  const rangosAEliminar: { from: number; to: number }[] = [];
  for (let i = 0; i < hijos.length - 1; i++) {
    const actual = hijos[i].node;
    const siguiente = hijos[i + 1].node;
    const esFantasma =
      actual.type.name === 'taskList' &&
      actual.childCount === 1 &&
      actual.child(0).type.name === 'taskItem' &&
      actual.textContent.trim() === '' &&
      (siguiente.type.name === 'bulletList' || siguiente.type.name === 'orderedList');
    if (esFantasma) {
      rangosAEliminar.push({ from: hijos[i].pos, to: hijos[i].pos + actual.nodeSize });
    }
  }
  if (!rangosAEliminar.length) return;

  const tr = editor.state.tr;
  for (let i = rangosAEliminar.length - 1; i >= 0; i--) {
    tr.delete(rangosAEliminar[i].from, rangosAEliminar[i].to);
  }
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

interface SlashOpcion {
  id: string;
  label: string;
  hint: string;
  run: (editor: Editor) => void;
}

interface SlashEstado {
  from: number;
  to: number;
  query: string;
  x: number;
  y: number;
  seleccion: number;
}

/**
 * CQ2 — Editor "con formato" para Dev notes (y reutilizable donde haga falta):
 * TipTap (ProseMirror) + `tiptap-markdown` para que el contenido entre y salga
 * como Markdown plano (el storage de `sgc.notas.contenido` NO cambia). Atajos de
 * Markdown al escribir (`# `, `- `, `**`, `[ ]`, ``` ```) ya vienen de serie en
 * las extensiones de nodo/marca de `starter-kit`/`task-item`. El menú "/" es
 * casero (sin `@tiptap/suggestion`): un popup HTML simple anclado con
 * `coordsAtPos`, suficiente para 5 opciones fijas.
 *
 * Hermano de `shared/ui/editor-plantilla` (mismo patrón TipTap+Angular), pero
 * sin tocarlo: ese editor serializa a HTML (plantillas de Documentos), este a
 * Markdown (notas). No comparten código porque sus extensiones/serialización
 * divergen demasiado para que valga la pena una base común en esta ronda.
 */
@Component({
  selector: 'app-rich-editor',
  templateUrl: './rich-editor.html',
  styleUrl: './rich-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichEditor implements AfterViewInit, OnDestroy, OnChanges {
  /** Markdown plano (el mismo formato que `sgc.notas.contenido`). */
  value = input<string>('');
  disabled = input<boolean>(false);
  placeholder = input<string>('Escribe, o «/» para insertar lista, título, código, tabla…');

  valueChange = output<string>();

  @ViewChild('host', { static: false }) host?: ElementRef<HTMLDivElement>;

  private editor: Editor | null = null;

  slash = signal<SlashEstado | null>(null);
  vacio = signal(true);

  private readonly OPCIONES: SlashOpcion[] = [
    { id: 'titulo', label: 'Título', hint: '## Título', run: (e) => { e.chain().focus().toggleHeading({ level: 2 }).run(); } },
    { id: 'lista', label: 'Lista', hint: '- elemento', run: (e) => { e.chain().focus().toggleBulletList().run(); } },
    { id: 'tareas', label: 'Tareas', hint: '- [ ] pendiente', run: (e) => { e.chain().focus().toggleTaskList().run(); } },
    { id: 'codigo', label: 'Código', hint: '```', run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
    { id: 'tabla', label: 'Tabla', hint: '3×3', run: (e) => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  ];

  opcionesFiltradas = computed(() => {
    const s = this.slash();
    if (!s) return [] as SlashOpcion[];
    const q = s.query.trim().toLowerCase();
    if (!q) return this.OPCIONES;
    return this.OPCIONES.filter((o) => o.id.includes(q) || o.label.toLowerCase().includes(q));
  });

  ngAfterViewInit() {
    this.crearEditor(this.value());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value'] && this.editor && !changes['value'].firstChange) {
      const actual = this.editor.storage['markdown'].getMarkdown();
      // Solo re-sincroniza si el cambio vino de FUERA (otra nota, revertir, etc.);
      // si viniera de nuestro propio onUpdate, ya coincide y no tocamos el cursor.
      if (this.value() !== actual) {
        this.editor.commands.setContent(this.value(), false);
        repararListaFantasma(this.editor);
        this.vacio.set(this.editor.isEmpty);
      }
    }
    if (changes['disabled'] && this.editor) {
      this.editor.setEditable(!this.disabled());
    }
  }

  private crearEditor(markdownInicial: string) {
    if (!this.host) return;
    this.editor = new Editor({
      element: this.host.nativeElement,
      editable: !this.disabled(),
      extensions: extensionesNotasRicas(),
      content: markdownInicial,
      editorProps: {
        attributes: { class: 're__prosemirror', 'aria-label': 'Contenido de la nota' },
        handleKeyDown: (_view, event) => this.manejarTecla(event),
      },
      onCreate: ({ editor }) => {
        repararListaFantasma(editor);
        this.vacio.set(editor.isEmpty);
      },
      onUpdate: ({ editor }) => {
        this.emitir(editor);
        this.actualizarSlash(editor);
        this.vacio.set(editor.isEmpty);
      },
      onSelectionUpdate: ({ editor }) => this.actualizarSlash(editor),
    });
  }

  private emitir(editor: Editor) {
    const md: string = editor.storage['markdown'].getMarkdown();
    this.valueChange.emit(md);
  }

  private actualizarSlash(editor: Editor) {
    const { state } = editor;
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock) {
      this.slash.set(null);
      return;
    }
    const textoAntes = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = /(?:^|\s)\/([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]*)$/.exec(textoAntes);
    if (!match) {
      this.slash.set(null);
      return;
    }
    const query = match[1];
    const desde = $from.pos - query.length - 1;
    const coords = editor.view.coordsAtPos($from.pos);
    const anterior = this.slash();
    const nOpciones = Math.max(this.opcionesFiltradas().length, 1);
    this.slash.set({
      from: desde,
      to: $from.pos,
      query,
      x: coords.left,
      y: coords.bottom + 6,
      seleccion: anterior ? Math.min(anterior.seleccion, nOpciones - 1) : 0,
    });
  }

  private manejarTecla(event: KeyboardEvent): boolean {
    const s = this.slash();
    if (!s) return false;
    const opciones = this.opcionesFiltradas();
    if (event.key === 'ArrowDown') {
      this.slash.set({ ...s, seleccion: opciones.length ? (s.seleccion + 1) % opciones.length : 0 });
      event.preventDefault();
      return true;
    }
    if (event.key === 'ArrowUp') {
      this.slash.set({ ...s, seleccion: opciones.length ? (s.seleccion - 1 + opciones.length) % opciones.length : 0 });
      event.preventDefault();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const opt = opciones[s.seleccion];
      if (opt) {
        event.preventDefault();
        this.ejecutar(opt, s);
        return true;
      }
    }
    if (event.key === 'Escape') {
      this.slash.set(null);
      event.preventDefault();
      return true;
    }
    return false;
  }

  ejecutar(opt: SlashOpcion, estado: SlashEstado | null = this.slash()) {
    if (!this.editor || !estado) return;
    this.editor.chain().focus().deleteRange({ from: estado.from, to: estado.to }).run();
    opt.run(this.editor);
    this.slash.set(null);
  }

  ngOnDestroy() {
    this.editor?.destroy();
  }
}
