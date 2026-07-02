import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { DocumentoGenerado } from '../../../../shared/models/plantilla-documento.model';

@Component({
  selector: 'app-documentos-ver',
  imports: [RouterLink],
  templateUrl: './ver.html',
  styleUrl: './ver.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ver implements OnInit {
  private route = inject(ActivatedRoute);
  private plantillasService = inject(PlantillasDocumentoService);
  private sanitizer = inject(DomSanitizer);

  documento = signal<DocumentoGenerado | null>(null);
  contenidoSafe = signal<SafeHtml | null>(null);
  loading = signal(true);
  error = signal('');

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
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el documento.');
    } finally {
      this.loading.set(false);
    }
  }

  imprimir() {
    window.print();
  }
}
