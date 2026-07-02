import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SolicitudesCompraService } from '../../../../shared/services/solicitudes-compra.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { SolicitudCompra } from '../../../../shared/models/solicitud.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

interface ItemRow {
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string;
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  convertida: 'success',
  rechazada: 'danger',
};

@Component({
  selector: 'app-bitacora-solicitudes-compra',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './solicitudes-compra.html',
  styleUrl: './solicitudes-compra.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesCompra implements OnInit {
  private solicitudesService = inject(SolicitudesCompraService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;
  estadoBadge = (estado: string) => ESTADO_BADGE[estado] ?? 'neutral';

  solicitudes = signal<SolicitudCompra[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  formItems = signal<ItemRow[]>([{ descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);

  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    notas: new FormControl<string | null>(null),
  });

  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [solicitudes, proyectos] = await Promise.all([
        this.solicitudesService.getAll(),
        this.proyectosService.getAll(),
      ]);
      this.solicitudes.set(solicitudes);
      this.proyectos.set(proyectos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las solicitudes.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.saveError.set('');
    this.form.reset();
    this.formItems.set([{ descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { descripcion: '', cantidad: 1, proveedor_sugerido: '' }]);
  }

  removeItem(index: number) {
    this.formItems.update((items) => items.filter((_, i) => i !== index));
  }

  updateItem(index: number, field: keyof ItemRow, value: string) {
    this.formItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: field === 'cantidad' ? Number(value) : value } : item)),
    );
  }

  async onSave() {
    this.form.markAllAsTouched();
    const items = this.formItems().filter((i) => i.descripcion.trim() && i.cantidad > 0);
    if (this.form.invalid || this.saving() || items.length === 0) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      const solicitanteId = this.userService.profile()?.id;
      if (!solicitanteId) throw new Error('Sesión inválida.');

      const v = this.form.value;
      const created = await this.solicitudesService.create({
        proyecto_id: v.proyecto_id!,
        solicitante_id: solicitanteId,
        notas: v.notas ?? null,
        items: items.map((i) => ({
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          proveedor_sugerido: i.proveedor_sugerido || null,
        })),
      });
      this.solicitudes.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
