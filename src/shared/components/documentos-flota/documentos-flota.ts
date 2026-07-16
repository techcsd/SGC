import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DocumentosFlotaService } from '../../services/documentos-flota.service';
import { UserService } from '../../../app/core/services/user.service';
import {
  DocumentoEntidad,
  DocumentoFlota,
  DocSlot,
  DOC_SLOTS,
} from '../../models/documento-flota.model';

@Component({
  selector: 'app-documentos-flota',
  imports: [],
  templateUrl: './documentos-flota.html',
  styleUrl: './documentos-flota.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosFlota implements OnInit {
  entidad = input.required<DocumentoEntidad>();
  entidadId = input.required<string>();
  /** Si viene un tipo (p.ej. desde un aviso de vencimiento), abre ese documento al cargar. */
  autoAbrir = input<string | null>(null);

  private documentosService = inject(DocumentosFlotaService);
  private userService = inject(UserService);
  private sanitizer = inject(DomSanitizer);

  documentos = signal<DocumentoFlota[]>([]);
  loading = signal(true);
  error = signal('');
  uploadingTipo = signal<string | null>(null);
  nombreOtro = signal('');

  viewerDoc = signal<DocumentoFlota | null>(null);
  viewerUrl = signal<SafeResourceUrl | null>(null);
  rawViewerUrl = signal<string | null>(null);
  downloading = signal(false);

  slots = computed<DocSlot[]>(() => DOC_SLOTS[this.entidad()]);
  destacados = computed(() => this.slots().filter((s) => s.destacado));
  private destacadoTipos = computed(() => new Set(this.destacados().map((s) => s.value)));

  canManage = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('flota'),
  );

  /** Documento de un slot destacado (el más reciente si hubiera varios). */
  docDe(tipo: string): DocumentoFlota | null {
    return this.documentos().find((d) => d.tipo === tipo) ?? null;
  }

  /** "Otros": todo lo que no cae en un slot destacado. */
  otros = computed(() =>
    this.documentos().filter((d) => !this.destacadoTipos().has(d.tipo)),
  );

  /** Cuántos documentos solicitados faltan (para el indicador del encabezado). */
  faltantes = computed(() => this.destacados().filter((s) => !this.docDe(s.value)).length);

  async ngOnInit() {
    await this.load();
    const t = this.autoAbrir();
    if (t) {
      const doc = this.docDe(t);
      if (doc) await this.abrirVisor(doc);
    }
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.documentos.set(
        await this.documentosService.getByEntidad(this.entidad(), this.entidadId()),
      );
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los documentos.');
    } finally {
      this.loading.set(false);
    }
  }

  async onFileSelected(tipo: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploadingTipo.set(tipo);
    this.error.set('');
    try {
      const usuarioId = this.userService.profile()?.id ?? null;
      const nombre = tipo === 'otro' ? this.nombreOtro() || file.name : file.name;
      const created = await this.documentosService.upload(
        this.entidad(),
        this.entidadId(),
        tipo,
        file,
        nombre,
        usuarioId,
      );
      this.documentos.update((list) => [created, ...list]);
      if (tipo === 'otro') this.nombreOtro.set('');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al subir el documento.');
    } finally {
      this.uploadingTipo.set(null);
    }
  }

  async eliminar(doc: DocumentoFlota) {
    if (!confirm(`¿Eliminar “${doc.nombre ?? 'documento'}”?`)) return;
    try {
      await this.documentosService.remove(doc.id, doc.path);
      this.documentos.update((list) => list.filter((d) => d.id !== doc.id));
      if (this.viewerDoc()?.id === doc.id) this.cerrarVisor();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al eliminar el documento.');
    }
  }

  async abrirVisor(doc: DocumentoFlota) {
    this.viewerDoc.set(doc);
    this.viewerUrl.set(null);
    this.rawViewerUrl.set(null);
    try {
      const url = await this.documentosService.getSignedUrl(doc.path);
      this.rawViewerUrl.set(url);
      this.viewerUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al abrir el documento.');
    }
  }

  cerrarVisor() {
    this.viewerDoc.set(null);
    this.viewerUrl.set(null);
    this.rawViewerUrl.set(null);
  }

  async descargar(doc: DocumentoFlota) {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.error.set('');
    try {
      const blob = await this.documentosService.downloadBlob(doc.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nombre ?? 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al descargar el documento.');
    } finally {
      this.downloading.set(false);
    }
  }

  abrirEnPestana() {
    const url = this.rawViewerUrl();
    if (url) window.open(url, '_blank', 'noopener');
  }

  esPdf(doc: DocumentoFlota): boolean {
    return (doc.nombre ?? '').toLowerCase().endsWith('.pdf') || doc.path.toLowerCase().endsWith('.pdf');
  }

  esImagen(doc: DocumentoFlota): boolean {
    return /\.(png|jpe?g|webp|gif)$/i.test(doc.nombre ?? doc.path);
  }
}
