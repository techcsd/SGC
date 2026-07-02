import { Component, ChangeDetectionStrategy, inject, input, signal, computed, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DocumentosProyectoService } from '../../services/documentos-proyecto.service';
import { UserService } from '../../../app/core/services/user.service';
import { DocumentoProyecto, DocumentoTipo, DOCUMENTO_TIPOS } from '../../models/documento-proyecto.model';

@Component({
  selector: 'app-documentos-proyecto',
  imports: [],
  templateUrl: './documentos-proyecto.html',
  styleUrl: './documentos-proyecto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosProyecto implements OnInit {
  proyectoId = input.required<string>();

  private documentosService = inject(DocumentosProyectoService);
  private userService = inject(UserService);
  private sanitizer = inject(DomSanitizer);

  readonly DOCUMENTO_TIPOS = DOCUMENTO_TIPOS;

  documentos = signal<DocumentoProyecto[]>([]);
  loading = signal(true);
  error = signal('');
  uploading = signal(false);
  uploadTipo = signal<DocumentoTipo>('contrato');

  viewerDoc = signal<DocumentoProyecto | null>(null);
  viewerUrl = signal<SafeResourceUrl | null>(null);

  canManage = computed(
    () => this.userService.hasRole('admin') || this.userService.hasModulo('proyectos'),
  );

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.documentos.set(await this.documentosService.getByProyecto(this.proyectoId()));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los documentos.');
    } finally {
      this.loading.set(false);
    }
  }

  porTipo(tipo: DocumentoTipo): DocumentoProyecto[] {
    return this.documentos().filter((d) => d.tipo === tipo);
  }

  onUploadTipoChange(value: string) {
    this.uploadTipo.set(value as DocumentoTipo);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploading.set(true);
    this.error.set('');
    try {
      const usuarioId = this.userService.profile()?.id ?? null;
      const created = await this.documentosService.upload(this.proyectoId(), this.uploadTipo(), file, usuarioId);
      this.documentos.update((list) => [created, ...list]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al subir el documento.');
    } finally {
      this.uploading.set(false);
    }
  }

  async eliminar(doc: DocumentoProyecto) {
    try {
      await this.documentosService.remove(doc.id, doc.archivo_path);
      this.documentos.update((list) => list.filter((d) => d.id !== doc.id));
      if (this.viewerDoc()?.id === doc.id) this.cerrarVisor();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al eliminar el documento.');
    }
  }

  async abrirVisor(doc: DocumentoProyecto) {
    this.viewerDoc.set(doc);
    this.viewerUrl.set(null);
    if (!doc.contenido_html) {
      try {
        const url = await this.documentosService.getSignedUrl(doc.archivo_path);
        this.viewerUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      } catch (e: unknown) {
        this.error.set(e instanceof Error ? e.message : 'Error al abrir el documento.');
      }
    }
  }

  cerrarVisor() {
    this.viewerDoc.set(null);
    this.viewerUrl.set(null);
  }

  esPdf(doc: DocumentoProyecto): boolean {
    return (doc.tipo_mime ?? '').includes('pdf') || doc.nombre.toLowerCase().endsWith('.pdf');
  }

  esImagen(doc: DocumentoProyecto): boolean {
    return (doc.tipo_mime ?? '').startsWith('image/');
  }
}
