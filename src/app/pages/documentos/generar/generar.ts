import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { PlantillaDocumento, CATEGORIA_LABELS } from '../../../../shared/models/plantilla-documento.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { todayIso } from '../../../../shared/utils/fecha.util';

@Component({
  selector: 'app-documentos-generar',
  imports: [],
  templateUrl: './generar.html',
  styleUrl: './generar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Generar implements OnInit {
  private plantillasService = inject(PlantillasDocumentoService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);

  readonly CATEGORIA_LABELS = CATEGORIA_LABELS;

  plantillas = signal<PlantillaDocumento[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);

  plantillaSeleccionada = signal<PlantillaDocumento | null>(null);
  proyectoId = signal<string>('');
  valores = signal<Record<string, string>>({});
  previewHtml = signal<string | null>(null);

  previewSafe = computed<SafeHtml | null>(() => {
    const html = this.previewHtml();
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : null;
  });

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [plantillas, proyectos] = await Promise.all([
        this.plantillasService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.plantillas.set(plantillas);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las plantillas.');
    } finally {
      this.loading.set(false);
    }
  }

  onPlantillaChange(id: string) {
    const plantilla = this.plantillas().find((p) => p.id === id) ?? null;
    this.plantillaSeleccionada.set(plantilla);
    this.valores.set({});
    this.previewHtml.set(null);
  }

  onProyectoChange(id: string) {
    this.proyectoId.set(id);
  }

  onValorChange(key: string, value: string) {
    this.valores.update((v) => ({ ...v, [key]: value }));
  }

  generarVistaPrevia() {
    const plantilla = this.plantillaSeleccionada();
    if (!plantilla) return;
    this.previewHtml.set(this.plantillasService.renderizar(plantilla.contenido_html, this.valores()));
  }

  onPreviewEdit(value: string) {
    this.previewHtml.set(value);
  }

  async guardar() {
    const plantilla = this.plantillaSeleccionada();
    const html = this.previewHtml();
    if (!plantilla || !html || this.saving()) return;

    this.saving.set(true);
    this.error.set('');
    try {
      const generadoPor = this.userService.profile()?.id ?? null;
      const doc = await this.plantillasService.generar({
        plantillaId: plantilla.id,
        nombre: `${plantilla.nombre} — ${todayIso()}`,
        proyectoId: this.proyectoId() || null,
        valores: this.valores(),
        contenidoHtmlFinal: html,
        generadoPor,
      });
      this.router.navigate(['/documentos/ver', doc.id]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al guardar el documento.');
    } finally {
      this.saving.set(false);
    }
  }
}
