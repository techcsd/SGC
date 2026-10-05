import { Component, ChangeDetectionStrategy, input, output, computed, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * CG13 — visor de PDF embebido (modal) reutilizable en toda la web.
 * El PDF se muestra en un <iframe> con los controles nativos del navegador
 * (zoom, página, imprimir) y una cabecera propia con Descargar / Abrir en pestaña /
 * Cerrar. Recibe una URL (típicamente firmada del bucket) y el nombre a mostrar.
 * Para imágenes usar el lightbox existente; esto es solo para application/pdf.
 */
@Component({
  selector: 'app-pdf-viewer',
  templateUrl: './pdf-viewer.html',
  styleUrl: './pdf-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfViewer {
  private sanitizer = inject(DomSanitizer);

  open = input<boolean>(false);
  src = input<string | null>(null);
  nombre = input<string>('Documento');

  closed = output<void>();

  safeSrc = computed<SafeResourceUrl | null>(() => {
    const url = this.src();
    if (!url) return null;
    // #toolbar=1 pide la barra nativa; #view=FitH encaja el ancho.
    const withHint = url.includes('#') ? url : `${url}#view=FitH`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(withHint);
  });

  cerrar() {
    this.closed.emit();
  }

  onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.cerrar();
  }
}
