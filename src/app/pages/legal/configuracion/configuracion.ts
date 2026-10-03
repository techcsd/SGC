import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmpresaService, TestigoFrecuente } from '../../../../shared/services/empresa.service';
import { PlantillasDocumentoService } from '../../../../shared/services/plantillas-documento.service';
import { PlantillaDocumento, CATEGORIA_LABELS, PlantillaCategoria } from '../../../../shared/models/plantilla-documento.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/** CF7 — Configuración legal: datos del empleador, testigos frecuentes y plantilla por defecto. */
@Component({
  selector: 'app-legal-configuracion',
  imports: [RouterLink, Skeleton],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalConfiguracion implements OnInit {
  private empresaSvc = inject(EmpresaService);
  private plantillasSvc = inject(PlantillasDocumentoService);
  private toast = inject(ToastService);

  readonly CATEGORIA_LABELS = CATEGORIA_LABELS;
  loading = signal(true);
  saving = signal(false);

  // Datos del empleador.
  razon_social = signal('');
  rnc = signal('');
  direccion = signal('');
  ciudad = signal('');
  representante = signal('');
  gerente_general = signal('');
  testigos = signal<TestigoFrecuente[]>([]);

  plantillas = signal<PlantillaDocumento[]>([]);

  async ngOnInit() {
    this.loading.set(true);
    try {
      const [emp, pls] = await Promise.all([this.empresaSvc.get(), this.plantillasSvc.getAll()]);
      if (emp) {
        this.razon_social.set(emp.razon_social ?? '');
        this.rnc.set(emp.rnc ?? '');
        this.direccion.set(emp.direccion ?? '');
        this.ciudad.set(emp.ciudad ?? '');
        this.representante.set(emp.representante ?? '');
        this.gerente_general.set(emp.gerente_general ?? '');
        this.testigos.set(emp.testigos_frecuentes ?? []);
      }
      this.plantillas.set(pls);
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }
  }

  agregarTestigo() { this.testigos.update((t) => [...t, { nombre: '', cedula: '' }]); }
  quitarTestigo(i: number) { this.testigos.update((t) => t.filter((_, idx) => idx !== i)); }
  setTestigo(i: number, campo: 'nombre' | 'cedula', val: string) {
    this.testigos.update((t) => t.map((x, idx) => idx === i ? { ...x, [campo]: val } : x));
  }

  defaultDe(cat: PlantillaCategoria): PlantillaDocumento | undefined {
    return this.plantillas().find((p) => p.categoria === cat && p.es_default);
  }

  async guardar() {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.empresaSvc.guardarConfigLegal({
        razon_social: this.razon_social().trim() || null,
        rnc: this.rnc().trim() || null,
        direccion: this.direccion().trim() || null,
        ciudad: this.ciudad().trim() || null,
        representante: this.representante().trim() || null,
        gerente_general: this.gerente_general().trim() || null,
        testigos: this.testigos().filter((t) => t.nombre.trim() || t.cedula.trim()),
      });
      this.toast.success('Configuración guardada');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }
}
