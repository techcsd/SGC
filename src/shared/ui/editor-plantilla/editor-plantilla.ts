import {
  Component, ChangeDetectionStrategy, inject, input, output, signal, computed,
  ElementRef, ViewChild, AfterViewInit, OnDestroy, OnChanges, SimpleChanges,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { UserService } from '../../../app/core/services/user.service';
import { Icon } from '../icon/icon';
import { CampoPlantilla, CampoTipo } from '../../models/plantilla-documento.model';
import { PlantillasDocumentoService } from '../../services/plantillas-documento.service';
import { CampoNode, envolverCamposEnHtml } from './campo-node.extension';

const TIPOS: { value: CampoTipo; label: string }[] = [
  { value: 'texto', label: 'Texto' },
  { value: 'numero', label: 'Número' },
  { value: 'fecha', label: 'Fecha' },
  { value: 'textarea', label: 'Texto largo' },
];

/**
 * CO12/CO14 — editor de plantillas tipo Word. TipTap (ProseMirror, MIT) +
 * nodo `campo` (ficha naranja) para insertar datos sin tocar HTML crudo. El
 * HTML crudo queda disponible SOLO para Tecnología, en "Avanzado".
 */
@Component({
  selector: 'app-editor-plantilla',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-plantilla.html',
  styleUrl: './editor-plantilla.scss',
})
export class EditorPlantilla implements AfterViewInit, OnDestroy, OnChanges {
  private userService = inject(UserService);
  private plantillasService = inject(PlantillasDocumentoService);

  /** HTML inicial (de la plantilla a editar). */
  html = input.required<string>();
  /** Campos ya conocidos de la plantilla (para el panel derecho). */
  campos = input<CampoPlantilla[]>([]);
  /** Valores de ejemplo para "Probar con datos" (opcional). */
  datosEjemplo = input<Record<string, string>>({});

  htmlChange = output<string>();
  camposChange = output<CampoPlantilla[]>();

  @ViewChild('editorHost', { static: false }) editorHost?: ElementRef<HTMLDivElement>;

  private editor: Editor | null = null;
  readonly TIPOS = TIPOS;

  esTecnologia = computed(() => this.userService.hasRole('admin') || this.userService.hasModulo('tecnologia'));
  modoAvanzado = signal(false);
  avanzadoHtml = signal('');

  probandoConDatos = signal(false);
  previewHtml = signal('');

  // "+ Dato nuevo"
  mostrandoDatoNuevo = signal(false);
  nuevoDatoKey = signal('');
  nuevoDatoLabel = signal('');
  nuevoDatoTipo = signal<CampoTipo>('texto');

  mostrandoInsertar = signal(false);

  ngAfterViewInit() {
    this.crearEditor(this.html());
  }

  ngOnChanges(changes: SimpleChanges) {
    // Si el padre cambia el html (p. ej. al abrir otra plantilla) y el editor ya
    // existe, re-sincroniza contenido sin perder el listener.
    if (changes['html'] && this.editor && !changes['html'].firstChange) {
      this.editor.commands.setContent(envolverCamposEnHtml(this.html()));
    }
  }

  private crearEditor(htmlInicial: string) {
    if (!this.editorHost) return;
    this.editor = new Editor({
      element: this.editorHost.nativeElement,
      extensions: [
        StarterKit,
        Underline,
        Table.configure({ resizable: true }),
        TableRow, TableHeader, TableCell,
        CampoNode,
      ],
      content: envolverCamposEnHtml(htmlInicial),
      onUpdate: ({ editor }) => this.emitirCambio(editor.getHTML()),
    });
  }

  private emitirCambio(html: string) {
    this.htmlChange.emit(html);
    const nuevos = this.plantillasService.camposDesdeHtml(html);
    // Conserva tipo/label ya definidos para los campos que siguen existiendo.
    const previos = new Map(this.campos().map((c) => [c.key, c]));
    this.camposChange.emit(nuevos.map((c) => previos.get(c.key) ?? c));
  }

  ngOnDestroy() {
    this.editor?.destroy();
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  toggleBold() { this.editor?.chain().focus().toggleBold().run(); }
  toggleItalic() { this.editor?.chain().focus().toggleItalic().run(); }
  toggleUnderline() { this.editor?.chain().focus().toggleUnderline().run(); }
  toggleHeading() { this.editor?.chain().focus().toggleHeading({ level: 2 }).run(); }
  toggleBulletList() { this.editor?.chain().focus().toggleBulletList().run(); }
  insertarTabla() { this.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }
  insertarFirma() {
    this.editor?.chain().focus().insertContent(
      '<p>&nbsp;</p><p>_______________________________</p><p>Firma</p>',
    ).run();
  }
  activo(mark: 'bold' | 'italic' | 'underline'): boolean {
    return this.editor?.isActive(mark) ?? false;
  }

  // ── "+ Insertar dato" ────────────────────────────────────────────────────
  insertarCampo(key: string) {
    this.editor?.chain().focus().insertContent({ type: 'campo', attrs: { key } }).run();
    this.mostrandoInsertar.set(false);
  }

  abrirDatoNuevo() {
    this.nuevoDatoKey.set('');
    this.nuevoDatoLabel.set('');
    this.nuevoDatoTipo.set('texto');
    this.mostrandoDatoNuevo.set(true);
  }
  confirmarDatoNuevo() {
    const label = this.nuevoDatoLabel().trim();
    if (!label) return;
    const key = this.nuevoDatoKey().trim() || label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) return;
    const nuevo: CampoPlantilla = { key, label, tipo: this.nuevoDatoTipo() };
    this.camposChange.emit([...this.campos().filter((c) => c.key !== key), nuevo]);
    this.insertarCampo(key);
    this.mostrandoDatoNuevo.set(false);
  }

  // ── "Probar con datos" ───────────────────────────────────────────────────
  toggleProbarConDatos() {
    if (!this.probandoConDatos()) {
      const html = this.editor?.getHTML() ?? '';
      this.previewHtml.set(this.plantillasService.renderizarResaltado(html, this.datosEjemplo(), this.campos()));
    }
    this.probandoConDatos.update((v) => !v);
  }

  // ── "Avanzado" — HTML crudo, solo Tecnología ────────────────────────────
  toggleAvanzado() {
    const abrir = !this.modoAvanzado();
    if (abrir) this.avanzadoHtml.set(this.editor?.getHTML() ?? '');
    this.modoAvanzado.set(abrir);
  }
  aplicarHtmlAvanzado() {
    this.editor?.commands.setContent(envolverCamposEnHtml(this.avanzadoHtml()));
    this.emitirCambio(this.editor?.getHTML() ?? '');
    this.modoAvanzado.set(false);
  }
}
