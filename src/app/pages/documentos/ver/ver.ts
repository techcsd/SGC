import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { DocumentoGenerado, CATEGORIA_LABELS } from '../../../../shared/models/plantilla-documento.model';
import { LegalService } from '../../../../shared/services/legal.service';
import { UserService } from '../../../core/services/user.service';
import { AprobacionLegal } from '../../../../shared/models/legal.model';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-documentos-ver',
  imports: [RouterLink, Skeleton],
  templateUrl: './ver.html',
  styleUrl: './ver.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ver implements OnInit {
  private route = inject(ActivatedRoute);
  private plantillasService = inject(PlantillasDocumentoService);
  private sanitizer = inject(DomSanitizer);
  private legalService = inject(LegalService);
  private userService = inject(UserService);

  readonly CATEGORIA_LABELS = CATEGORIA_LABELS;
  readonly formatTimestamp = formatTimestampDisplay;

  documento = signal<DocumentoGenerado | null>(null);
  contenidoSafe = signal<SafeHtml | null>(null);
  loading = signal(true);
  error = signal('');

  revisionLegal = signal<AprobacionLegal | null>(null);
  solicitandoRevision = signal(false);
  revisionError = signal('');

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Documento no especificado.');
      this.loading.set(false);
      return;
    }
    try {
      const doc = await this.plantillasService.getGeneradoById(id);
      this.documento.set(doc);
      this.contenidoSafe.set(this.sanitizer.bypassSecurityTrustHtml(doc.contenido_html_final));
      const revisiones = await this.legalService.getAprobacionesPorReferencia(id);
      this.revisionLegal.set(revisiones[0] ?? null);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el documento.');
    } finally {
      this.loading.set(false);
    }
  }

  async solicitarRevisionLegal() {
    const doc = this.documento();
    const userId = this.userService.profile()?.id;
    if (!doc || !userId || this.solicitandoRevision()) return;

    this.solicitandoRevision.set(true);
    this.revisionError.set('');
    try {
      const aprobacion = await this.legalService.solicitarAprobacion({
        moduloOrigen: 'documentos',
        referenciaTipo: 'documento_generado',
        referenciaId: doc.id,
        titulo: doc.nombre,
        descripcion: `Solicitud de revisión legal para el documento "${doc.nombre}".`,
        solicitadoPor: userId,
      });
      this.revisionLegal.set(aprobacion);
    } catch (e: unknown) {
      this.revisionError.set(e instanceof Error ? e.message : 'Error al solicitar la revisión.');
    } finally {
      this.solicitandoRevision.set(false);
    }
  }

  estadoRevisionLabel(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'Revisión legal pendiente';
      case 'aprobado': return 'Aprobado por Legal';
      case 'rechazado': return 'Rechazado por Legal';
      default: return estado;
    }
  }

  imprimir() {
    window.print();
  }

  /** QA-077 — Descarga el HTML renderizado como .doc abrible en Word (truco
   *  HTML + MIME application/msword, sin dependencias nuevas). */
  descargarWord() {
    const doc = this.documento();
    if (!doc) return;
    const html =
      `<html><head><meta charset="utf-8"></head><body>${doc.contenido_html_final}</body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const nombre = (doc.nombre || 'documento').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
