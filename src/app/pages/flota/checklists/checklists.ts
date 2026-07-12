import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ChecklistsVehiculoService } from '../../../../shared/services/checklists-vehiculo.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import {
  ChecklistPlantilla,
  ChecklistVehiculo,
  ChecklistFormData,
  ChecklistTipo,
  ChecklistRespuestaValor,
  CHECKLIST_TIPOS,
  RESPUESTA_OPCIONES,
  categoriaPorTipoVehiculo,
} from '../../../../shared/models/flota-checklist.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';

/**
 * Checklists digitales de flota (pre-uso e inspección de seguridad). Historial +
 * registro web. Un checklist con un ítem crítico marcado en NO exige atención
 * (se resuelve desde el detalle), y alimenta el badge de pendientes en Flota.
 */
@Component({
  selector: 'app-checklists',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe],
  templateUrl: './checklists.html',
  styleUrl: './checklists.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checklists implements OnInit {
  private checklistsService = inject(ChecklistsVehiculoService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  // ── Data ─────────────────────────────────────────────────
  checklists = signal<ChecklistVehiculo[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  conductores = signal<Conductor[]>([]);
  plantillas = signal<ChecklistPlantilla[]>([]);

  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');
  dbNotReady = signal(false);

  // ── Filters ──────────────────────────────────────────────
  searchQuery = signal('');
  selectedTipo = signal('');
  soloCriticos = signal(false);

  // ── Create drawer ────────────────────────────────────────
  drawerOpen = signal(false);
  /** Plantilla elegida (señal para que los ítems se rendericen reactivo). */
  selectedPlantillaId = signal<string>('');
  /** item.id → respuesta OK/NO/NA (default 'na'). */
  private respuestas = signal<Record<string, ChecklistRespuestaValor>>({});
  /** item.id → comentario. */
  private comentarios = signal<Record<string, string>>({});

  // ── Detail drawer ────────────────────────────────────────
  detailOpen = signal(false);
  loadingDetail = signal(false);
  selected = signal<ChecklistVehiculo | null>(null);
  private fotoUrls = signal<Record<string, string>>({});
  notaAtencion = signal('');
  atendiendo = signal(false);

  readonly TIPOS = CHECKLIST_TIPOS;
  readonly OPCIONES = RESPUESTA_OPCIONES;

  form = new FormGroup({
    vehiculo_id: new FormControl<string | null>(null, [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    plantilla_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<ChecklistTipo>('pre_uso', [Validators.required]),
    fecha: new FormControl(todayIso(), [Validators.required]),
    kilometraje: new FormControl<number | null>(null, [Validators.min(0)]),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const soloCrit = this.soloCriticos();

    return this.checklists().filter((c) => {
      if (soloCrit && !(c.tiene_criticos && !c.atendido)) return false;
      if (tipo && c.tipo !== tipo) return false;
      if (q) {
        const placa = c.vehiculo?.placa?.toLowerCase() ?? '';
        const conductor = c.conductor?.nombre?.toLowerCase() ?? '';
        if (!placa.includes(q) && !conductor.includes(q)) return false;
      }
      return true;
    });
  });

  criticosPendientes = computed(
    () => this.checklists().filter((c) => c.tiene_criticos && !c.atendido).length,
  );

  /** Plantilla actualmente seleccionada en el drawer (con sus ítems). */
  selectedPlantilla = computed(() =>
    this.plantillas().find((p) => p.id === this.selectedPlantillaId()) ?? null,
  );

  /** Ítems críticos marcados en NO en el formulario actual. */
  private criticosEnNo = computed(() => {
    const items = this.selectedPlantilla()?.items ?? [];
    const resp = this.respuestas();
    return items.filter((it) => it.es_critico && (resp[it.id] ?? 'na') === 'no');
  });

  criticosEnNoCount = computed(() => this.criticosEnNo().length);

  /** Fotos firmadas del checklist en detalle. */
  fotosDetalle = computed(() => {
    const map = this.fotoUrls();
    return Object.entries(map).map(([key, url]) => ({ key, url }));
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    this.dbNotReady.set(false);
    try {
      const [checklists, vehiculos, conductores, plantillas] = await Promise.all([
        this.checklistsService.getChecklists(),
        this.vehiculosService.getAll(),
        this.conductoresService.getAll(),
        this.checklistsService.getPlantillas(),
      ]);
      this.checklists.set(checklists);
      this.vehiculos.set(vehiculos);
      this.conductores.set(conductores);
      this.plantillas.set(plantillas);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('permission denied')) {
        this.dbNotReady.set(true);
      } else {
        this.error.set(msg || 'Error al cargar los checklists.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  // ── Filters ──────────────────────────────────────────────
  onSearch(value: string) { this.searchQuery.set(value); }
  onTipoChange(value: string) { this.selectedTipo.set(value); }
  toggleCriticos() { this.soloCriticos.update((v) => !v); }

  // ── Create ───────────────────────────────────────────────
  openCreate() {
    this.saveError.set('');
    this.selectedPlantillaId.set('');
    this.respuestas.set({});
    this.comentarios.set({});
    this.form.reset({
      vehiculo_id: null,
      conductor_id: null,
      plantilla_id: null,
      tipo: 'pre_uso',
      fecha: todayIso(),
      kilometraje: null,
      observaciones: null,
    });
    this.drawerOpen.set(true);
  }

  closeDrawer() { this.drawerOpen.set(false); }

  /** Al elegir vehículo, sugiere la plantilla de su categoría (o 'general'). */
  onVehiculoChange(vehiculoId: string) {
    // Autosugerir conductor asignado a ese vehículo, si aún no eligió otro.
    if (!this.form.controls.conductor_id.value) {
      const asignado = this.conductores().find((c) => c.vehiculo_id === vehiculoId);
      if (asignado) this.form.controls.conductor_id.setValue(asignado.id);
    }

    if (this.selectedPlantillaId()) return; // respeta una elección previa
    const vehiculo = this.vehiculos().find((v) => v.id === vehiculoId);
    const categoria = categoriaPorTipoVehiculo(vehiculo?.tipo);
    const sugerida =
      this.plantillas().find((p) => p.categoria === categoria) ??
      this.plantillas().find((p) => p.categoria === 'general');
    if (sugerida) this.selectPlantilla(sugerida.id);
  }

  onPlantillaChange(plantillaId: string) {
    this.selectPlantilla(plantillaId);
  }

  private selectPlantilla(plantillaId: string) {
    this.form.controls.plantilla_id.setValue(plantillaId);
    this.selectedPlantillaId.set(plantillaId);
    // Reinicia respuestas a 'na' para los ítems de la plantilla.
    const items = this.plantillas().find((p) => p.id === plantillaId)?.items ?? [];
    const base: Record<string, ChecklistRespuestaValor> = {};
    for (const it of items) base[it.id] = 'na';
    this.respuestas.set(base);
    this.comentarios.set({});
  }

  getRespuesta(itemId: string): ChecklistRespuestaValor {
    return this.respuestas()[itemId] ?? 'na';
  }

  setRespuesta(itemId: string, valor: ChecklistRespuestaValor) {
    this.respuestas.update((m) => ({ ...m, [itemId]: valor }));
  }

  getComentario(itemId: string): string {
    return this.comentarios()[itemId] ?? '';
  }

  setComentario(itemId: string, texto: string) {
    this.comentarios.update((m) => ({ ...m, [itemId]: texto }));
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const plantilla = this.selectedPlantilla();
    if (!plantilla) {
      this.saveError.set('Selecciona una plantilla.');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const raw = this.form.value;
    const resp = this.respuestas();
    const coment = this.comentarios();
    const criticosNo = this.criticosEnNoCount();

    const payload: ChecklistFormData = {
      plantilla_id: plantilla.id,
      vehiculo_id: raw.vehiculo_id!,
      conductor_id: raw.conductor_id || null,
      tipo: raw.tipo ?? 'pre_uso',
      fecha: raw.fecha ?? todayIso(),
      datos: {},
      kilometraje: raw.kilometraje ?? null,
      observaciones: raw.observaciones?.trim() || null,
      respuestas: (plantilla.items ?? []).map((it) => ({
        etiqueta: it.etiqueta,
        seccion: it.seccion,
        es_critico: it.es_critico,
        respuesta: resp[it.id] ?? 'na',
        comentario: coment[it.id]?.trim() || null,
        orden: it.orden,
      })),
    };

    try {
      const id = await this.checklistsService.registrar(payload);
      const created = await this.checklistsService.getById(id);
      this.checklists.update((list) => [created, ...list]);
      this.drawerOpen.set(false);

      if (criticosNo > 0) {
        this.toast.warning(
          'Checklist registrado con ítems críticos',
          `${criticosNo} ítem${criticosNo !== 1 ? 's' : ''} crítico${criticosNo !== 1 ? 's' : ''} en NO. Requiere atención.`,
        );
      } else {
        this.toast.success('Checklist registrado', 'El checklist se guardó correctamente.');
      }
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar el checklist.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detail ───────────────────────────────────────────────
  async openDetail(row: ChecklistVehiculo) {
    this.detailOpen.set(true);
    this.loadingDetail.set(true);
    this.selected.set(null);
    this.fotoUrls.set({});
    this.notaAtencion.set('');
    try {
      const full = await this.checklistsService.getById(row.id);
      this.selected.set(full);
      await this.resolveFotos(full);
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
      this.detailOpen.set(false);
    } finally {
      this.loadingDetail.set(false);
    }
  }

  private async resolveFotos(checklist: ChecklistVehiculo) {
    const map: Record<string, string> = {};
    await Promise.all(
      (checklist.fotos ?? []).map(async (f, i) => {
        try {
          const url = await this.checklistsService.getFotoUrl(f.storage_path);
          if (url) map[f.slot ?? `foto_${i}`] = url;
        } catch {
          /* omite una foto que no se pueda firmar */
        }
      }),
    );
    this.fotoUrls.set(map);
  }

  closeDetail() { this.detailOpen.set(false); }

  onNotaInput(value: string) { this.notaAtencion.set(value); }

  async atender() {
    const checklist = this.selected();
    if (!checklist || this.atendiendo()) return;

    this.atendiendo.set(true);
    const nota = this.notaAtencion().trim() || null;
    try {
      await this.checklistsService.atender(checklist.id, nota);
      const perfil = this.userService.profile();
      const patch: Partial<ChecklistVehiculo> = {
        atendido: true,
        nota_atencion: nota,
        atendido_por: perfil?.id ?? null,
        atendido_en: new Date().toISOString(),
      };
      this.selected.update((c) => (c ? { ...c, ...patch } : c));
      this.checklists.update((list) =>
        list.map((c) => (c.id === checklist.id ? { ...c, ...patch } : c)),
      );
      this.toast.success('Checklist atendido', 'Se marcó como atendido.');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo atender el checklist.');
    } finally {
      this.atendiendo.set(false);
    }
  }

  // ── Labels / helpers ─────────────────────────────────────
  getTipoLabel(tipo: string): string {
    return this.TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
  }

  getRespuestaBadge(valor: string): string {
    return this.OPCIONES.find((o) => o.value === valor)?.badge ?? 'neutral';
  }

  getRespuestaLabel(valor: string): string {
    return this.OPCIONES.find((o) => o.value === valor)?.label ?? valor;
  }

  formatFecha(fecha: string | null | undefined): string {
    return formatFechaDisplay(fecha);
  }

  vehiculoLabel(c: ChecklistVehiculo): string {
    if (!c.vehiculo) return '—';
    return `${c.vehiculo.marca} ${c.vehiculo.modelo}`;
  }

  get f() { return this.form.controls; }
}
