import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  ApiServiciosService,
  ApiServicio,
  ApiServicioInput,
} from '../../../../shared/services/api-servicios.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { ToastService } from '../../../../shared/services/toast.service';

/** AW9 — Inventario de APIs/servicios del proyecto y su costo estimado/mes. */
@Component({
  selector: 'app-tec-apis-consumo',
  imports: [FormsModule, DecimalPipe, Skeleton],
  templateUrl: './apis-consumo.html',
  styleUrl: './apis-consumo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecApisConsumo implements OnInit {
  private service = inject(ApiServiciosService);
  private toast = inject(ToastService);

  servicios = signal<ApiServicio[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);

  // Formulario de alta/edición (drawer inline).
  editorOpen = signal(false);
  editId = signal<number | null>(null);
  form = signal<Partial<ApiServicioInput>>({});

  /** Costo total estimado/mes por moneda. */
  totales = computed(() => {
    const acc: Record<string, number> = {};
    for (const s of this.servicios()) {
      if (s.costo_estimado_mes != null) acc[s.moneda] = (acc[s.moneda] ?? 0) + Number(s.costo_estimado_mes);
    }
    return Object.entries(acc).map(([moneda, total]) => ({ moneda, total }));
  });
  conCosto = computed(() => this.servicios().filter((s) => s.costo_estimado_mes != null).length);

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.servicios.set(await this.service.getAll());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  nuevo() {
    this.editId.set(null);
    this.form.set({ moneda: 'USD', activo: true });
    this.editorOpen.set(true);
  }

  editar(s: ApiServicio) {
    this.editId.set(s.id);
    this.form.set({ ...s });
    this.editorOpen.set(true);
  }

  cerrarEditor() {
    this.editorOpen.set(false);
    this.form.set({});
  }

  setField<K extends keyof ApiServicioInput>(key: K, value: ApiServicioInput[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async guardar() {
    const f = this.form();
    if (!f.nombre || !f.nombre.trim()) {
      this.toast.error('Falta el nombre', 'Escribe el nombre de la API/servicio.');
      return;
    }
    this.saving.set(true);
    try {
      const patch: Partial<ApiServicioInput> = {
        nombre: f.nombre.trim(),
        proveedor: f.proveedor?.trim() || null,
        proposito: f.proposito?.trim() || null,
        donde_se_usa: f.donde_se_usa?.trim() || null,
        costo_estimado_mes: f.costo_estimado_mes != null && `${f.costo_estimado_mes}` !== '' ? Number(f.costo_estimado_mes) : null,
        moneda: f.moneda || 'USD',
        panel_url: f.panel_url?.trim() || null,
        notas: f.notas?.trim() || null,
      };
      const id = this.editId();
      if (id) await this.service.update(id, patch);
      else await this.service.create(patch);
      this.cerrarEditor();
      await this.load();
      this.toast.success('Guardado');
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async eliminar(s: ApiServicio) {
    if (!confirm(`¿Eliminar "${s.nombre}" del inventario de APIs?`)) return;
    try {
      await this.service.remove(s.id);
      await this.load();
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    }
  }
}
