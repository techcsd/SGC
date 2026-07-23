import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  viewChild,
  OnInit,
} from '@angular/core';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ChecklistsVehiculoService } from '../../../../shared/services/checklists-vehiculo.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { DatosPruebaService } from '../../../../shared/services/datos-prueba.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { Conductor } from '../../../../shared/models/conductor.model';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  ChecklistVehiculo,
  ChecklistFormData,
  ChecklistTipo,
  ChecklistRespuestaValor,
  ChecklistResultado,
  AlertaMantenimiento,
  CHECKLIST_TIPOS,
  RESPUESTA_OPCIONES,
  NIVEL_COMBUSTIBLE_OPCIONES,
  RESULTADO_META,
  ALERTA_MANT_META,
  FOTO_SLOTS,
  categoriaPorTipoVehiculo,
  frecuenciaLabel,
} from '../../../../shared/models/flota-checklist.model';
import { claseVehiculo } from '../../../../shared/models/vehiculo.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { VehiculoPicker } from '../../../../shared/components/vehiculo-picker/vehiculo-picker';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { cleanUuid } from '../../../../shared/utils/uuid.util';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

/**
 * Checklists digitales de flota (pre-uso e inspección de seguridad). Historial +
 * registro web. Un checklist con un ítem crítico marcado en NO exige atención
 * (se resuelve desde el detalle), y alimenta el badge de pendientes en Flota.
 */
@Component({
  selector: 'app-checklists',
  imports: [Skeleton, ReactiveFormsModule, FormDrawer, DecimalPipe, RouterLink, VehiculoPicker, SignaturePad],
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
  private datosPrueba = inject(DatosPruebaService);
  private route = inject(ActivatedRoute);

  // T2 — solo admin ve/gestiona datos de prueba.
  esAdmin = computed(() => this.userService.hasRole('admin'));
  /** W7 — visibilidad GLOBAL de datos de prueba (compartida con el shell). */
  private datosPruebaViewSvc = inject(DatosPruebaViewService);
  mostrarPrueba = this.datosPruebaViewSvc.ver;

  /** U8 — frecuencia solicitada al abrir el drawer (query param ?frecuencia=). */
  private targetFrecuencia: 'preuso' | 'semanal' = 'preuso';
  readonly frecuenciaLabel = frecuenciaLabel;

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
  /** Fotos a subir al registrar: slot (fijo o `item_N`) → File. */
  private slotFotos = signal<Record<string, File>>({});
  slotPreviews = signal<Record<string, string>>({});
  /** Pad de firma del conductor (opcional) en el drawer de creación. */
  private firmaPad = viewChild<SignaturePad>('firmaPad');

  // ── Detail drawer ────────────────────────────────────────
  detailOpen = signal(false);
  loadingDetail = signal(false);
  selected = signal<ChecklistVehiculo | null>(null);
  private fotoUrls = signal<Record<string, string>>({});
  /** X3 — fotos por ítem (slot `item_N`) resueltas y etiquetadas por su respuesta. */
  private itemFotos = signal<{ orden: number; etiqueta: string; url: string }[]>([]);
  /** URL firmada de la firma del conductor (o null). */
  firmaUrl = signal<string | null>(null);
  notaAtencion = signal('');
  atendiendo = signal(false);

  readonly TIPOS = CHECKLIST_TIPOS;
  readonly OPCIONES = RESPUESTA_OPCIONES;
  readonly NIVELES = NIVEL_COMBUSTIBLE_OPCIONES;
  readonly FOTO_SLOTS = FOTO_SLOTS;

  form = new FormGroup({
    vehiculo_id: new FormControl<string | null>(null, [Validators.required]),
    conductor_id: new FormControl<string | null>(null),
    plantilla_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<ChecklistTipo>('pre_uso', [Validators.required]),
    fecha: new FormControl(todayIso(), [Validators.required]),
    kilometraje: new FormControl<number | null>(null, [Validators.min(0)]),
    nivel_combustible: new FormControl<string | null>(null),
    observaciones: new FormControl<string | null>(null),
  });

  // ── Computed ─────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tipo = this.selectedTipo();
    const soloCrit = this.soloCriticos();
    // T2 — admin: oculta datos de prueba salvo que active el toggle (no-admin nunca los recibe).
    const verPrueba = this.esAdmin() && this.mostrarPrueba();

    return this.checklists().filter((c) => {
      if (c.es_prueba && !verPrueba) return false;
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

  /** Vehículo elegido en el formulario (para clase y validaciones). */
  private selectedVehiculoForm = signal<string | null>(null);
  selectedVehiculo = computed(() =>
    this.vehiculos().find((v) => v.id === this.selectedVehiculoForm()) ?? null,
  );

  /** Ítems visibles según la clase del vehículo (Pesado ve los P1–P4). */
  visibleItems = computed<ChecklistPlantillaItem[]>(() => {
    const items = this.selectedPlantilla()?.items ?? [];
    const clase = claseVehiculo(this.selectedVehiculo()?.tipo);
    return items.filter((it) => it.aplica_a === 'Ambos' || it.aplica_a === clase);
  });

  /** Ítems visibles agrupados por sección (para renderizar el formulario). */
  itemsPorSeccion = computed(() => {
    const grupos = new Map<string, ChecklistPlantillaItem[]>();
    for (const it of this.visibleItems()) {
      const g = grupos.get(it.seccion) ?? [];
      g.push(it);
      grupos.set(it.seccion, g);
    }
    return [...grupos.entries()].map(([seccion, items]) => ({ seccion, items }));
  });

  /** Ítems críticos marcados en NO en el formulario actual. */
  private criticosEnNo = computed(() => {
    const resp = this.respuestas();
    return this.visibleItems().filter((it) => it.es_critico && (resp[it.id] ?? 'na') === 'no');
  });

  /** P6 — hallazgos críticos (crítico en NO) que aún no tienen comentario.
   *  El comentario es OBLIGATORIO en estos: bloquea el guardado. */
  private criticosSinComentario = computed(() => {
    const coment = this.comentarios();
    return this.criticosEnNo().filter((it) => !(coment[it.id] ?? '').trim());
  });

  /** P6 — true si un ítem crítico marcado en NO aún no tiene comentario (para la UI). */
  comentarioRequerido(itemId: string): boolean {
    const it = this.visibleItems().find((x) => x.id === itemId);
    if (!it?.es_critico) return false;
    if (this.getRespuesta(itemId) !== 'no') return false;
    return !this.getComentario(itemId).trim();
  }

  /** Progreso: ítems respondidos (OK/NO) sobre el total visible. */
  progreso = computed(() => {
    const items = this.visibleItems();
    const resp = this.respuestas();
    const respondidos = items.filter((it) => (resp[it.id] ?? 'na') !== 'na').length;
    return { respondidos, total: items.length };
  });

  /** Veredicto en vivo del formulario. */
  veredictoForm = computed<ChecklistResultado>(() => {
    const resp = this.respuestas();
    const items = this.visibleItems();
    const criticoNo = items.some((it) => it.es_critico && resp[it.id] === 'no');
    const hayNo = items.some((it) => resp[it.id] === 'no');
    return criticoNo ? 'bloqueado' : hayNo ? 'con_hallazgos' : 'aprobado';
  });
  veredictoFormMeta = computed(() => RESULTADO_META[this.veredictoForm()]);

  criticosEnNoCount = computed(() => this.criticosEnNo().length);

  /** Fotos firmadas del checklist en detalle. */
  fotosDetalle = computed(() => {
    const map = this.fotoUrls();
    return Object.entries(map).map(([key, url]) => ({ key, url }));
  });

  async ngOnInit() {
    await this.loadAll();
    // U8 — si se llega con ?frecuencia=semanal (CTA del dashboard de reporte
    // semanal), abre el drawer con la plantilla semanal ya preseleccionada.
    const frec = this.route.snapshot.queryParamMap.get('frecuencia');
    if (frec === 'semanal') {
      this.openCreate('semanal');
    }
  }

  /** Plantillas activas agrupadas por frecuencia, para el <select> con optgroup. */
  plantillasSemanal = computed(() =>
    this.plantillas().filter((p) => p.frecuencia === 'semanal'),
  );
  plantillasPreuso = computed(() =>
    this.plantillas().filter((p) => p.frecuencia !== 'semanal'),
  );

  /** Frecuencia legible de la plantilla seleccionada (badge del drawer). */
  selectedPlantillaFrecuencia = computed(() =>
    frecuenciaLabel(this.selectedPlantilla()?.frecuencia),
  );

  /** Título del drawer según la frecuencia de la plantilla elegida. */
  drawerTitle = computed(() =>
    this.selectedPlantilla()?.frecuencia === 'semanal'
      ? 'Nuevo reporte semanal'
      : 'Nuevo checklist de pre-uso',
  );

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
  openCreate(frecuencia: 'preuso' | 'semanal' = 'preuso') {
    this.targetFrecuencia = frecuencia;
    this.saveError.set('');
    this.selectedPlantillaId.set('');
    this.selectedVehiculoForm.set(null);
    this.respuestas.set({});
    this.comentarios.set({});
    this.limpiarFotos();
    this.form.reset({
      vehiculo_id: null,
      conductor_id: null,
      plantilla_id: null,
      tipo: 'pre_uso',
      fecha: todayIso(),
      kilometraje: null,
      nivel_combustible: null,
      observaciones: null,
    });
    // U8 — preselecciona la plantilla de la frecuencia solicitada.
    const plantilla =
      this.plantillas().find((p) =>
        frecuencia === 'semanal' ? p.frecuencia === 'semanal' : p.frecuencia !== 'semanal',
      );
    if (plantilla) this.selectPlantilla(plantilla.id);
    this.drawerOpen.set(true);
  }

  closeDrawer() { this.drawerOpen.set(false); }

  /** Al elegir vehículo, sugiere la plantilla de su categoría (o 'general'). */
  onVehiculoChange(vehiculoId: string | null) {
    this.form.controls.vehiculo_id.setValue(vehiculoId);
    this.selectedVehiculoForm.set(vehiculoId);
    if (!vehiculoId) return;
    // Autosugerir conductor asignado a ese vehículo, si aún no eligió otro.
    // QA-045 — legacy: bajo el modelo de pool (vehiculo_asignaciones) un conductor
    // ya no tiene vehiculo_id fijo, así que esto rara vez acierta. Es inofensivo
    // (solo prellena); la sugerencia correcta vendría de la asignación activa.
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

  // ── Fotos del checklist (paridad con la app de campo) ────
  /** Foto de un slot fijo (delantera, tablero…) o de un ítem (`item_<orden>`). */
  async onSlotFoto(slot: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    const prevUrl = this.slotPreviews()[slot];
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    this.slotFotos.update((m) => ({ ...m, [slot]: comprimida }));
    this.slotPreviews.update((m) => ({ ...m, [slot]: URL.createObjectURL(comprimida) }));
  }

  quitarSlotFoto(slot: string) {
    const prevUrl = this.slotPreviews()[slot];
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    this.slotFotos.update((m) => {
      const { [slot]: _omit, ...rest } = m;
      return rest;
    });
    this.slotPreviews.update((m) => {
      const { [slot]: _omit, ...rest } = m;
      return rest;
    });
  }

  slotPreview(slot: string): string | null {
    return this.slotPreviews()[slot] ?? null;
  }

  itemSlot(orden: number): string {
    return `item_${orden}`;
  }

  private limpiarFotos() {
    for (const url of Object.values(this.slotPreviews())) URL.revokeObjectURL(url);
    this.slotFotos.set({});
    this.slotPreviews.set({});
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const plantilla = this.selectedPlantilla();
    if (!plantilla) {
      this.saveError.set('Selecciona una plantilla.');
      return;
    }

    // P6 — comentario obligatorio en hallazgos críticos (crítico marcado en NO).
    // No se puede guardar sin explicar qué pasó con el vehículo.
    const sinComentario = this.criticosSinComentario();
    if (sinComentario.length > 0) {
      const etiquetas = sinComentario.map((it) => `“${it.etiqueta}”`).join(', ');
      this.saveError.set(
        `Explica qué pasó en el/los hallazgo(s) crítico(s): ${etiquetas}. El comentario es obligatorio cuando un ítem crítico se marca en NO.`,
      );
      return;
    }

    // QA-044 — el odómetro no retrocede: el km capturado no puede ser menor al
    // último registrado del vehículo (guarda cliente, igual que en combustible).
    const kmForm = this.form.controls.kilometraje.value;
    const veh = this.selectedVehiculo();
    if (kmForm != null && veh && kmForm < veh.kilometraje) {
      this.saveError.set(
        `El kilometraje (${kmForm} km) no puede ser menor al último registrado del vehículo (${veh.kilometraje} km).`,
      );
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
      conductor_id: cleanUuid(raw.conductor_id), // C2 — "null" de <select> → null
      tipo: raw.tipo ?? 'pre_uso',
      fecha: raw.fecha ?? todayIso(),
      datos: {},
      kilometraje: raw.kilometraje ?? null,
      nivel_combustible: raw.nivel_combustible || null,
      observaciones: raw.observaciones?.trim() || null,
      respuestas: this.visibleItems().map((it) => ({
        etiqueta: it.etiqueta,
        seccion: it.seccion,
        es_critico: it.es_critico,
        respuesta: resp[it.id] ?? 'na',
        comentario: coment[it.id]?.trim() || null,
        orden: it.orden,
      })),
    };

    try {
      // Paridad app de campo: subir fotos (slots fijos + por ítem) y firma ANTES
      // del RPC, usando un id de cliente para enlazarlas.
      const id = this.checklistsService.nuevoId();
      const fotos: { slot: string; storage_path: string }[] = [];
      for (const [slot, file] of Object.entries(this.slotFotos())) {
        try {
          fotos.push(await this.checklistsService.uploadFoto(id, slot, file));
        } catch {
          /* una foto que no suba no debe abortar el registro */
        }
      }
      let firmaPath: string | null = null;
      const pad = this.firmaPad();
      if (pad && !pad.isEmpty()) {
        const blob = await pad.toBlob();
        if (blob) {
          try {
            firmaPath = await this.checklistsService.uploadFirma(id, blob);
          } catch {
            /* la firma es opcional */
          }
        }
      }
      await this.checklistsService.registrar(payload, { id, fotos, firmaPath });
      const created = await this.checklistsService.getById(id);
      this.checklists.update((list) => [created, ...list]);
      this.drawerOpen.set(false);
      this.checklistsService.notificarEvento(created); // email no bloqueante

      if (created.resultado === 'bloqueado') {
        this.toast.error(
          'Vehículo BLOQUEADO',
          `${criticosNo} ítem(s) crítico(s) en NO. El vehículo no puede salir. Se notificó a Flota.`,
        );
      } else if (created.resultado === 'con_hallazgos') {
        this.toast.warning(
          'Aprobado con hallazgos',
          'Hay ítems no críticos en NO. Coordinar corrección.',
        );
      } else {
        this.toast.success('Checklist aprobado', 'El vehículo puede operar.');
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
    this.itemFotos.set([]);
    this.firmaUrl.set(null);
    this.notaAtencion.set('');
    try {
      const full = await this.checklistsService.getById(row.id);
      this.selected.set(full);
      await this.resolveFotos(full);
      if (full.firma_path) {
        this.firmaUrl.set(await this.checklistsService.getFotoUrl(full.firma_path));
      }
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
      this.detailOpen.set(false);
    } finally {
      this.loadingDetail.set(false);
    }
  }

  private async resolveFotos(checklist: ChecklistVehiculo) {
    const map: Record<string, string> = {};
    const items: { orden: number; etiqueta: string; url: string }[] = [];
    // Etiqueta de cada ítem por su orden (para nombrar las fotos por-ítem).
    const etiquetaPorOrden = new Map(
      (checklist.respuestas ?? []).map((r) => [r.orden, r.etiqueta]),
    );
    await Promise.all(
      (checklist.fotos ?? []).map(async (f, i) => {
        try {
          const url = await this.checklistsService.getFotoUrl(f.storage_path);
          if (!url) return;
          const slot = f.slot ?? `foto_${i}`;
          // X3 — las fotos por ítem que sube la app usan slot `item_N` (N = orden).
          const m = /^item_(\d+)$/.exec(slot);
          if (m) {
            const orden = Number(m[1]);
            items.push({ orden, etiqueta: etiquetaPorOrden.get(orden) ?? `Ítem ${orden}`, url });
          } else {
            map[slot] = url;
          }
        } catch {
          /* omite una foto que no se pueda firmar */
        }
      }),
    );
    items.sort((a, b) => a.orden - b.orden);
    this.fotoUrls.set(map);
    this.itemFotos.set(items);
  }

  /** X3 — fotos por ítem del ítem con ese `orden` (para la galería inline en hallazgos). */
  fotosDeItem(orden: number): string[] {
    return this.itemFotos()
      .filter((f) => f.orden === orden)
      .map((f) => f.url);
  }

  /** X3 — fotos por ítem agrupadas por ítem, para la galería del detalle. */
  itemFotosGrupos = computed(() => {
    const grupos = new Map<number, { orden: number; etiqueta: string; urls: string[] }>();
    for (const f of this.itemFotos()) {
      const g = grupos.get(f.orden) ?? { orden: f.orden, etiqueta: f.etiqueta, urls: [] };
      g.urls.push(f.url);
      grupos.set(f.orden, g);
    }
    return [...grupos.values()].sort((a, b) => a.orden - b.orden);
  });

  closeDetail() { this.detailOpen.set(false); }

  // ── T2 — datos de prueba (solo admin) ────────────────────
  /** Marca o desmarca un checklist como dato de prueba. */
  async marcarPrueba(c: ChecklistVehiculo, valor: boolean) {
    if (!this.esAdmin()) return;
    try {
      await this.datosPrueba.marcar('checklists_vehiculo', c.id, valor);
      this.checklists.update((list) => list.map((x) => (x.id === c.id ? { ...x, es_prueba: valor } : x)));
      this.selected.update((s) => (s && s.id === c.id ? { ...s, es_prueba: valor } : s));
      this.toast.success(valor ? 'Marcado como dato de prueba' : 'Ya no es dato de prueba');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

  /** Elimina definitivamente un checklist de prueba (solo admin). */
  async eliminarPrueba(c: ChecklistVehiculo) {
    if (!this.esAdmin() || !c.es_prueba) return;
    if (!confirm('¿Eliminar este dato de prueba? Esta acción no se puede deshacer.')) return;
    try {
      await this.datosPrueba.eliminar('checklists_vehiculo', c.id);
      this.checklists.update((list) => list.filter((x) => x.id !== c.id));
      this.detailOpen.set(false);
      this.toast.success('Dato de prueba eliminado');
    } catch (e: unknown) {
      this.toast.error('Error al eliminar', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  }

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

  // ── Reporte de inspección (detalle v2) ───────────────────
  /** Meta del resultado tri-estado (fallback para registros legacy). */
  resultadoMeta(c: ChecklistVehiculo): { label: string; badge: string } {
    if (c.resultado) return RESULTADO_META[c.resultado];
    return c.tiene_criticos ? RESULTADO_META.bloqueado : RESULTADO_META.aprobado;
  }

  alertaMantMeta(a: AlertaMantenimiento | null): { label: string; badge: string } {
    return ALERTA_MANT_META[a ?? 'ok'];
  }

  /** Hallazgos = respuestas en NO (crítico primero). */
  hallazgos = computed(() => {
    const c = this.selected();
    return (c?.respuestas ?? [])
      .filter((r) => r.respuesta === 'no')
      .sort((a, b) => Number(b.es_critico) - Number(a.es_critico));
  });

  /** 7 slots fijos con su URL firmada (o null) para la grilla de evidencia. */
  fotosGrid = computed(() => {
    const map = this.fotoUrls();
    return FOTO_SLOTS.map((s) => ({ ...s, url: map[s.slot] ?? null }));
  });

  imprimir() {
    window.print();
  }

  get f() { return this.form.controls; }
}
