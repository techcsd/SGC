import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { DocumentoGenerado, CATEGORIA_LABELS } from '../../../../shared/models/plantilla-documento.model';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-documentos-historial',
  imports: [RouterLink],
  templateUrl: './historial.html',
  styleUrl: './historial.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Historial implements OnInit {
  private plantillasService = inject(PlantillasDocumentoService);

  readonly CATEGORIA_LABELS = CATEGORIA_LABELS;
  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;

  documentos = signal<DocumentoGenerado[]>([]);
  loading = signal(true);
  error = signal('');

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.documentos.set(await this.plantillasService.getHistorial());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }
}
