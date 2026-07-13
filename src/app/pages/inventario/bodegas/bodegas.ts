import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Bodega, BodegaFormData } from '../../../../shared/models/bodega.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';

@Component({
  selector: 'app-bodegas',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe],
  templateUrl: './bodegas.html',
  styleUrl: './bodegas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Bodegas implements OnInit {
  private bodegasService = inject(BodegasService);
  private proyectosService = inject(ProyectosService);

  // ── Data state ──────────────────────────────────────────
  bodegas = signal<Bodega[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedStatus = signal<'all' | 'active' | 'inactive'>('all');

  // ── Pagination ───────────────────────────────────────────
  currentPage = signal(1);
  readonly PAGE_SIZE = 20;

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    ubicacion: new FormControl<string | null>(null),
    descripcion: new FormControl<string | null>(null),
    activo: new FormControl<boolean>(true),
    proyecto_id: new FormControl<string | null>(null),
    es_principal: new FormControl<boolean>(false),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const status = this.selectedStatus();

    return this.bodegas().filter((b) => {
      if (
        q &&
        !b.nombre.toLowerCase().includes(q) &&
        !(b.ubicacion?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (status === 'active' && !b.activo) return false;
      if (status === 'inactive' && b.activo) return false;
      return true;
    });
  });

  paginated = computed(() => {
    const start = (this.currentPage() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  totalPages = computed(() => Math.ceil(this.filtered().length / this.PAGE_SIZE));

  drawerTitle = computed(() => (this.editingId() ? 'Editar almacén' : 'Nuevo almacén'));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [bodegas, proyectos] = await Promise.all([
        this.bodegasService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.bodegas.set(bodegas);
      this.proyectos.set(proyectos.filter((p) => p.activo));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los almacenes.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
    this.currentPage.set(1);
  }

  onStatusChange(value: string) {
    this.selectedStatus.set(value as 'all' | 'active' | 'inactive');
    this.currentPage.set(1);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedStatus.set('all');
    this.currentPage.set(1);
  }

  // ── Pagination ───────────────────────────────────────────
  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  get pages(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      range.push(i);
    }
    return range;
  }

  // ── Drawer ───────────────────────────────────────────────
  openCreate() {
    this.editingId.set(null);
    this.saveError.set('');
    this.form.reset({
      activo: true,
      ubicacion: null,
      descripcion: null,
      proyecto_id: null,
      es_principal: false,
    });
    this.drawerOpen.set(true);
  }

  openEdit(bodega: Bodega) {
    this.editingId.set(bodega.id);
    this.saveError.set('');
    this.form.reset({
      nombre: bodega.nombre,
      ubicacion: bodega.ubicacion,
      descripcion: bodega.descripcion,
      activo: bodega.activo,
      proyecto_id: bodega.proyecto_id ?? null,
      es_principal: bodega.es_principal ?? false,
    });
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

    const payload = this.form.value as BodegaFormData;

    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.bodegasService.update(id, payload);
        this.bodegas.update((list) => list.map((b) => (b.id === id ? updated : b)));
      } else {
        const created = await this.bodegasService.create(payload);
        this.bodegas.update((list) => [created, ...list]);
      }
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async toggleActivo(bodega: Bodega) {
    const next = !bodega.activo;
    this.bodegas.update((list) =>
      list.map((b) => (b.id === bodega.id ? { ...b, activo: next } : b)),
    );
    try {
      await this.bodegasService.toggleActivo(bodega.id, next);
    } catch {
      // revert on error
      this.bodegas.update((list) =>
        list.map((b) => (b.id === bodega.id ? { ...b, activo: !next } : b)),
      );
    }
  }

  get f() {
    return this.form.controls;
  }
}
