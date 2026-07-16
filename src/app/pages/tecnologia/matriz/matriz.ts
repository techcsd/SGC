import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  TecMatrizEntry,
  TecHerramienta,
} from '../../../../shared/models/tecnologia.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface PuestoGroup {
  puesto: string;
  entries: TecMatrizEntry[];
}

@Component({
  selector: 'app-tec-matriz',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton],
  templateUrl: './matriz.html',
  styleUrl: './matriz.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecMatriz implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private toast = inject(ToastService);

  matriz = signal<TecMatrizEntry[]>([]);
  herramientas = signal<TecHerramienta[]>([]);
  puestosSugeridos = signal<string[]>([]); // QA-080 — datalist del campo puesto
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);

  form = new FormGroup({
    puesto: new FormControl('', [Validators.required, Validators.maxLength(120)]),
    herramienta_id: new FormControl<string | null>(null, [Validators.required]),
    obligatorio: new FormControl<boolean>(true),
    notas: new FormControl<string | null>(null),
  });

  // Agrupa las entradas por puesto (orden alfabético ya viene del servicio).
  grupos = computed<PuestoGroup[]>(() => {
    const map = new Map<string, TecMatrizEntry[]>();
    for (const e of this.matriz()) {
      const list = map.get(e.puesto) ?? [];
      list.push(e);
      map.set(e.puesto, list);
    }
    return Array.from(map.entries()).map(([puesto, entries]) => ({ puesto, entries }));
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [matriz, herramientas, puestos] = await Promise.all([
        this.tecnologia.getMatriz(),
        this.tecnologia.getHerramientas(true),
        this.tecnologia.getPuestosSugeridos(), // QA-080 (best-effort)
      ]);
      this.matriz.set(matriz);
      this.herramientas.set(herramientas);
      this.puestosSugeridos.set(puestos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la matriz.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Drawer ────────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.form.reset({ obligatorio: true, puesto: '', herramienta_id: null, notas: null });
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const v = this.form.value;
    try {
      const created = await this.tecnologia.addMatriz({
        puesto: v.puesto!.trim(),
        herramienta_id: v.herramienta_id!,
        obligatorio: v.obligatorio ?? true,
        notas: v.notas ?? null,
      });
      this.matriz.update((list) => [...list, created]);
      this.toast.success('Herramienta asignada al puesto');
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(entry: TecMatrizEntry) {
    const nombre = entry.herramienta?.nombre ?? 'esta herramienta';
    if (!confirm(`¿Quitar "${nombre}" del puesto "${entry.puesto}"?`)) return;
    try {
      await this.tecnologia.removeMatriz(entry.id);
      this.matriz.update((list) => list.filter((x) => x.id !== entry.id));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'Error al quitar.');
    }
  }

  get f() {
    return this.form.controls;
  }
}
