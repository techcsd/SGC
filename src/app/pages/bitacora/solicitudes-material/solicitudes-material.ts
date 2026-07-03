import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { SolicitudMaterial } from '../../../../shared/models/solicitud.model';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';

interface ItemRow {
  descripcion: string;
  cantidad: number;
  unidad: string;
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  aprobada: 'info',
  entregada: 'success',
  rechazada: 'danger',
};

@Component({
  selector: 'app-bitacora-solicitudes-material',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './solicitudes-material.html',
  styleUrl: './solicitudes-material.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolicitudesMaterial implements OnInit {
  private solicitudesService = inject(SolicitudesMaterialService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  estadoBadge = (estado: string) => ESTADO_BADGE[estado] ?? 'neutral';

  solicitudes = signal<SolicitudMaterial[]>([]);
  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  drawerOpen = signal(false);
  formItems = signal<ItemRow[]>([{ descripcion: '', cantidad: 1, unidad: '' }]);

  form = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    urgencia: new FormControl<'normal' | 'urgente'>('normal', [Validators.required]),
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
    this.form.reset({ urgencia: 'normal' });
    this.formItems.set([{ descripcion: '', cantidad: 1, unidad: '' }]);
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  addItem() {
    this.formItems.update((items) => [...items, { descripcion: '', cantidad: 1, unidad: '' }]);
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
        urgencia: v.urgencia!,
        notas: v.notas ?? null,
        items: items.map((i) => ({ articulo_id: null, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad || null })),
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
