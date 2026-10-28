import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { EmpleadosService, EmpleadoDirectorio } from '../../../../shared/services/empleados.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import {
  TecEquipo,
  TecEquipoFormData,
  TecEquipoEstado,
  TecEquipoHistorial,
  TecCompraOpcion,
  TecGrupoCampos,
  TEC_EQUIPO_ESTADOS,
  TEC_EQUIPO_CONDICIONES,
} from '../../../../shared/models/tecnologia.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { Icon } from '../../../../shared/ui/icon/icon';
import { formatFechaDisplay, formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { tonoDeEstado } from '../../../../shared/utils/estado-tono';
import QRCode from 'qrcode';

/** AL1 — foto de la galería (existente o pendiente de subir). `key` identifica la
 *  portada (path si es existente, o el preview blob si es nueva). */
interface FotoItem {
  key: string; // path (existente) | preview url (nueva)
  url: string; // signed url (existente) | preview url (nueva)
  path: string | null; // path si ya está en storage; null si es nueva
  file: File | null; // archivo si es nueva
}

@Component({
  selector: 'app-tec-inventario',
  imports: [ReactiveFormsModule, RouterLink, FormDrawer, Skeleton, Lightbox, Icon],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecInventario implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private empleadosService = inject(EmpleadosService);
  private bodegasService = inject(BodegasService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private route = inject(ActivatedRoute);

  // DA-06 — gate propio (NO el genérico de módulo tecnología, ver user.service.ts).
  puedeVerClaves = this.userService.puedeVerClavesEquipos;

  // DA7/DA-04 — catálogos administrables de situación/condición (se cargan de
  // la BD en loadAll(); TEC_EQUIPO_ESTADOS/TEC_EQUIPO_CONDICIONES son solo el
  // fallback si la tabla no responde).
  estados = signal<{ value: string; label: string }[]>(TEC_EQUIPO_ESTADOS);
  condiciones = signal<{ value: string; label: string }[]>(TEC_EQUIPO_CONDICIONES);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;

  equipos = signal<TecEquipo[]>([]);
  empleados = signal<EmpleadoDirectorio[]>([]);
  comprasOpciones = signal<TecCompraOpcion[]>([]); // QA-070
  tipos = signal<{ value: string; label: string; grupos_campos: TecGrupoCampos[] }[]>([]); // AL1 — catálogo
  garantiaAlertaDias = signal(30); // DA-18
  bodegas = signal<{ id: string; nombre: string; es_central: boolean }[]>([]); // AL1 — ubicación
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  saveError = signal('');

  // ── Filters ───────────────────────────────────────────────
  searchQuery = signal('');
  selectedEstado = signal<string>('');
  // DA-11/DA-12/DA-14 — filtros de la nota 7 (responsable externo, sin datos de compra/garantía)
  soloResponsableExterno = signal(false);
  soloSinCompra = signal(false);
  soloSinGarantia = signal(false);

  // ── Create/Edit drawer ────────────────────────────────────
  drawerOpen = signal(false);
  editingId = signal<string | null>(null);
  // DA-10 — si viene de "Agregar componente", el nuevo equipo nace kit_padre_id = este id.
  kitPadreIdParaCrear = signal<string | null>(null);

  // AL1 — agregar tipo nuevo en línea
  addingTipo = signal(false);
  newTipoLabel = signal('');

  // DA7/DA-04 — agregar situación/condición nueva en línea (mismo patrón que tipo)
  addingEstado = signal(false);
  newEstadoLabel = signal('');
  addingCondicion = signal(false);
  newCondicionLabel = signal('');

  // ── Detail/history drawer ─────────────────────────────────
  detailOpen = signal(false);
  detailEquipo = signal<TecEquipo | null>(null);
  // DZ-06 — cotización de origen: directa (tec_cotizacion_equipos) o, si no
  // hay, la elegida de su origen_solicitud_compra_id.
  cotizacionDeEquipo = signal<{ cotizacion_id: string; titulo: string; directa: boolean } | null>(null);
  historial = signal<TecEquipoHistorial[]>([]);
  historialLoading = signal(false);
  detalleFotos = signal<FotoItem[]>([]); // AL1 — galería del detalle (portada primero)

  // ── AL1 — galería multi-foto del formulario ───────────────
  fotos = signal<FotoItem[]>([]);
  portadaKey = signal<string | null>(null);
  listaPortadas = signal<Record<string, string>>({}); // id → url portada (thumbnails)

  // ── AL1 — lightbox ────────────────────────────────────────
  lightboxUrl = signal<string | null>(null);

  form = new FormGroup({
    nombre: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    tipo_id: new FormControl<string | null>(null, [Validators.required]),
    marca: new FormControl<string | null>(null),
    modelo: new FormControl<string | null>(null),
    serie: new FormControl<string | null>(null),
    estado: new FormControl<TecEquipoEstado>('en_stock', [Validators.required]),
    condicion: new FormControl<string>('funciona', [Validators.required]),
    empleado_id: new FormControl<string | null>(null),
    asignado_en: new FormControl<string | null>(null),
    bodega_id: new FormControl<string | null>(null),
    ubicacion: new FormControl<string | null>(null),
    notas: new FormControl<string | null>(null),
    // QA-071 — datos de compra/garantía
    costo: new FormControl<number | null>(null),
    moneda: new FormControl<'DOP' | 'USD'>('DOP'),
    fecha_compra: new FormControl<string | null>(null),
    garantia_hasta: new FormControl<string | null>(null),
    // QA-070 — origen: compra tecnológica
    origen_solicitud_compra_id: new FormControl<string | null>(null),
    // DA2/DA-02 — identificación
    service_tag: new FormControl<string | null>(null),
    codigo_servicio: new FormControl<string | null>(null),
    numero_parte: new FormControl<string | null>(null),
    modelo_regulatorio: new FormControl<string | null>(null),
    anio_fabricacion: new FormControl<number | null>(null),
    codigo_anterior: new FormControl<string | null>(null),
    imei: new FormControl<string | null>(null),
    etiqueta_taller: new FormControl<string | null>(null),
    // DA-11 — responsable sin usuario en el SGC
    responsable_externo: new FormControl<string | null>(null),
    // DA-12 — costo/garantía
    costo_origen: new FormControl<'compra' | 'estimado' | 'donado'>('compra'),
    fecha_compra_desconocida: new FormControl(false, { nonNullable: true }),
    garantia_desconocida: new FormControl(false, { nonNullable: true }),
  });

  // DA2/DA-03 — specs 1:1, bloque mostrado según grupos_campos del tipo elegido.
  specsForm = new FormGroup({
    procesador: new FormControl<string | null>(null),
    ram_gb: new FormControl<number | null>(null),
    ram_velocidad: new FormControl<string | null>(null),
    almacenamiento_tipo: new FormControl<'SSD' | 'HDD' | 'NVMe' | null>(null),
    almacenamiento_gb: new FormControl<number | null>(null),
    gpu_integrada: new FormControl<string | null>(null),
    gpu_dedicada: new FormControl<string | null>(null),
    gpu_memoria_gb: new FormControl<number | null>(null),
    so: new FormControl<string | null>(null),
    so_version: new FormControl<string | null>(null),
    pantalla_pulgadas: new FormControl<number | null>(null),
    resolucion: new FormControl<string | null>(null),
    tactil: new FormControl<boolean | null>(null),
    nombre_windows: new FormControl<string | null>(null),
    usuario_windows: new FormControl<string | null>(null),
    cargador_voltaje: new FormControl<string | null>(null),
    cargador_amperaje: new FormControl<string | null>(null),
    frecuencia: new FormControl<string | null>(null),
    potencia_w: new FormControl<number | null>(null),
    tipo_radio: new FormControl<'frecuencia' | 'celular_ptt' | null>(null),
    sello_telserdom_radio: new FormControl<string | null>(null),
    sello_telserdom_bateria: new FormControl<string | null>(null),
    bateria_modelo: new FormControl<string | null>(null),
    bateria_capacidad: new FormControl<number | null>(null),
    bateria_unidad: new FormControl<'mAh' | 'Wh' | null>(null),
    bateria_voltaje: new FormControl<string | null>(null),
    bateria_sello: new FormControl<string | null>(null),
    accesoriosTexto: new FormControl('', { nonNullable: true }), // CSV en UI → array al guardar
    camara_specs: new FormControl<string | null>(null),
  });

  // Situación en vivo del tipo elegido (para pintar el bloque de specs correcto
  // sin esperar a que `form.controls.tipo_id` recorra un ciclo de detección).
  tipoIdActual = signal<string | null>(null);
  currentGruposCampos = computed<TecGrupoCampos[]>(
    () => this.tipos().find((t) => t.value === this.tipoIdActual())?.grupos_campos ?? [],
  );
  onTipoIdChange(value: string) {
    this.tipoIdActual.set(value || null);
  }

  // DA9/DA-13 — lector de capturas de "Información del sistema" de Windows.
  leyendoCaptura = signal(false);
  // DA-14 — las mismas capturas, si Xaviel quiere, se guardan como foto
  // "especificaciones" (distinta de la portada) — se suben recién al guardar
  // el equipo, igual que la galería normal.
  capturasWindowsPendientes = signal<File[]>([]);

  async onCapturaWindowsPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length) return;
    this.capturasWindowsPendientes.update((list) => [...list, ...files]);
    this.leyendoCaptura.set(true);
    try {
      const r = await this.tecnologia.leerEspecificacionesEquipo(files);
      if (!r.ok || !r.specs) {
        this.toast.warning('No se pudo leer la captura', r.error ?? 'Llena los campos a mano.');
        return;
      }
      // Precarga para REVISAR — nunca se guarda sola (DA-13).
      const s = r.specs as Record<string, unknown>;
      this.specsForm.patchValue({
        procesador: (s['procesador'] as string) ?? this.specsForm.controls.procesador.value,
        ram_gb: (s['ram_gb'] as number) ?? this.specsForm.controls.ram_gb.value,
        almacenamiento_tipo: (s['almacenamiento_tipo'] as 'SSD' | 'HDD' | 'NVMe') ?? this.specsForm.controls.almacenamiento_tipo.value,
        almacenamiento_gb: (s['almacenamiento_gb'] as number) ?? this.specsForm.controls.almacenamiento_gb.value,
        so: (s['so'] as string) ?? this.specsForm.controls.so.value,
        so_version: (s['so_version'] as string) ?? this.specsForm.controls.so_version.value,
        nombre_windows: (s['nombre_windows'] as string) ?? this.specsForm.controls.nombre_windows.value,
        usuario_windows: (s['usuario_windows'] as string) ?? this.specsForm.controls.usuario_windows.value,
      });
      if (s['service_tag'] && !this.form.controls.service_tag.value) {
        this.form.controls.service_tag.setValue(s['service_tag'] as string);
      }
      this.toast.success('Captura leída', 'Revisa los campos antes de guardar — no se guardaron solos.');
    } catch (e: unknown) {
      this.toast.warning('No se pudo leer la captura', e instanceof Error ? e.message : 'Llena los campos a mano.');
    } finally {
      this.leyendoCaptura.set(false);
    }
  }

  drawerTitle = computed(() =>
    this.editingId() ? 'Editar equipo' : this.kitPadreIdParaCrear() ? 'Agregar componente al kit' : 'Nuevo equipo',
  );

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const estado = this.selectedEstado();
    return this.equipos().filter((e) => {
      if (
        q &&
        !e.nombre.toLowerCase().includes(q) &&
        !(e.codigo?.toLowerCase().includes(q) ?? false) &&
        !(e.serie?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (estado && e.estado !== estado) return false;
      if (this.soloResponsableExterno() && !e.responsable_externo) return false;
      if (this.soloSinCompra() && !(e.fecha_compra_desconocida || (!e.fecha_compra && !e.costo))) return false;
      if (this.soloSinGarantia() && !(e.garantia_desconocida || !e.garantia_hasta)) return false;
      return true;
    });
  });

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedEstado() ||
      this.soloResponsableExterno() ||
      this.soloSinCompra() ||
      this.soloSinGarantia(),
  );

  toggleResponsableExterno() {
    this.soloResponsableExterno.update((v) => !v);
  }
  toggleSinCompra() {
    this.soloSinCompra.update((v) => !v);
  }
  toggleSinGarantia() {
    this.soloSinGarantia.update((v) => !v);
  }

  async ngOnInit() {
    await this.loadAll();
    // DA-18 — la etiqueta QR abre /tecnologia/inventario?codigo=TEC-0002 y la ficha.
    const codigo = this.route.snapshot.queryParamMap.get('codigo');
    if (codigo) {
      const eq = this.equipos().find((e) => e.codigo === codigo);
      if (eq) await this.openDetail(eq);
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [equipos, empleados, compras, tipos, bodegas, estados, condiciones, garantiaDias] = await Promise.all([
        this.tecnologia.getEquipos(),
        this.empleadosService.getDirectorio(), // AN1 — referencia (no requiere módulo RRHH)
        this.tecnologia.getComprasTecOpciones(), // QA-070
        this.tecnologia.getEquipoTipos(), // AL1
        this.bodegasService.getSelectables(), // AR3 — fuente homologada (sin "· Central" sucios)
        this.tecnologia.getEquipoEstados(), // DA7
        this.tecnologia.getEquipoCondiciones(), // DA7
        this.tecnologia.getGarantiaAlertaDias(), // DA-18
      ]);
      this.equipos.set(equipos);
      this.empleados.set(empleados);
      this.comprasOpciones.set(compras);
      this.tipos.set(tipos);
      this.estados.set(estados);
      this.condiciones.set(condiciones);
      this.garantiaAlertaDias.set(garantiaDias);
      this.bodegas.set(
        (bodegas as { id: string; nombre: string; es_central: boolean }[]).map((b) => ({
          id: b.id,
          nombre: b.nombre,
          es_central: b.es_central,
        })),
      );
      this.resolverFotos(equipos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el inventario.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  getTipoLabel(e: TecEquipo): string {
    if (e.tipo_id) {
      const t = this.tipos().find((x) => x.value === e.tipo_id);
      if (t) return t.label;
    }
    return e.tipo ?? '—';
  }

  getEstadoLabel(value: string): string {
    return this.estados().find((e) => e.value === value)?.label ?? value;
  }

  // DA-22/CB2 — "estados = punto + palabra": el tono sale de la fuente ÚNICA
  // estado-tono.ts (no de un mapa local), igual que el resto del sistema.
  getEstadoTono(value: string): string {
    return tonoDeEstado(value);
  }

  getCondicionLabel(value: string): string {
    return this.condiciones().find((c) => c.value === value)?.label ?? value;
  }

  getCondicionTono(value: string): string {
    // "Funciona" se lee como éxito; el resto (averiado/por_diagnosticar/futuros)
    // cae al mapa genérico de estado-tono.ts (averiado→danger, por_*→warning).
    return value === 'funciona' ? 'success' : tonoDeEstado(value);
  }

  getEmpleadoNombre(e: TecEquipo): string {
    // AN1 — el embed `empleado:empleados(...)` falla para roles sin acceso a RRHH
    // (p.ej. Tecnología). Resolvemos primero desde el directorio de referencia.
    if (e.empleado_id) {
      const emp = this.empleados().find((x) => x.id === e.empleado_id);
      if (emp) return `${emp.nombre} ${emp.apellido ?? ''}`.trim();
    }
    if (e.empleado) return `${e.empleado.nombre} ${e.empleado.apellido}`;
    return '—';
  }

  // DA-11 — "quién lo tiene" cuando no hay usuario/empleado en el SGC (ej.
  // Cristofer, Contabilidad): no se inventa un empleado falso, se muestra tal cual.
  getQuienLoTiene(e: TecEquipo): string {
    if (e.empleado_id || e.empleado) return this.getEmpleadoNombre(e);
    if (e.responsable_externo) return `${e.responsable_externo} · sin usuario`;
    return '—';
  }

  getUbicacionLabel(e: TecEquipo): string {
    if (e.bodega_id) {
      const b = this.bodegas().find((x) => x.id === e.bodega_id);
      if (b) return b.nombre;
    }
    return e.ubicacion ?? '—';
  }

  // DA-18 — ¿la garantía de este equipo vence dentro de la ventana de alerta
  // (o ya venció)? "Desconocida" nunca cuenta como alerta (no es lo mismo que
  // vencida — DA-12).
  garantiaPorVencer(e: TecEquipo): boolean {
    if (e.garantia_desconocida || !e.garantia_hasta) return false;
    const limite = new Date();
    limite.setDate(limite.getDate() + this.garantiaAlertaDias());
    return new Date(e.garantia_hasta) <= limite;
  }

  garantiasPorVencerCount = computed(() => this.equipos().filter((e) => this.garantiaPorVencer(e)).length);

  // AL1 — costo formateado con su moneda (RD$ / US$).
  formatCosto(n: number | null | undefined, moneda?: 'DOP' | 'USD' | null): string {
    if (n == null) return '—';
    const simbolo = moneda === 'USD' ? 'US$' : 'RD$';
    return `${simbolo} ${Number(n).toLocaleString('es-DO', { maximumFractionDigits: 0 })}`;
  }

  // QA-070 — etiqueta de la compra de origen (para el detalle).
  compraLabel(id: string | null | undefined): string {
    if (!id) return '';
    return this.comprasOpciones().find((c) => c.id === id)?.label ?? 'Compra tecnológica';
  }

  // ── AL1 — resolución de portadas para el listado ──────────
  private portadaPathOf(e: TecEquipo): string | null {
    return e.foto_portada ?? (e.fotos && e.fotos.length ? e.fotos[0] : null) ?? e.foto_path ?? null;
  }

  private resolverFotos(equipos: TecEquipo[]) {
    for (const e of equipos) {
      const path = this.portadaPathOf(e);
      if (!path) continue;
      this.tecnologia.getEquipoFotoUrl(path).then((url) => {
        if (url) this.listaPortadas.update((m) => ({ ...m, [e.id]: url }));
      });
    }
  }

  fotoDe(e: TecEquipo): string | null {
    return this.listaPortadas()[e.id] ?? null;
  }

  onFotoError(equipoId: string) {
    this.listaPortadas.update((m) => {
      if (!(equipoId in m)) return m;
      const next = { ...m };
      delete next[equipoId];
      return next;
    });
  }

  // QA-050 — etiqueta es-DO para el tipo de cambio del historial.
  private readonly HIST_TIPO_LABELS: Record<string, string> = {
    registro: 'Registro',
    asignacion: 'Asignación',
    estado: 'Cambio de estado',
    edicion: 'Edición',
    reparacion: 'Reparación',
    baja: 'Dado de baja',
  };

  histTipoLabel(tipo: string): string {
    return this.HIST_TIPO_LABELS[tipo] ?? tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/_/g, ' ');
  }

  // ── AL1 — galería multi-foto del formulario ───────────────
  onFotosPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length) return;
    const nuevas: FotoItem[] = files.map((file) => {
      const preview = URL.createObjectURL(file);
      return { key: preview, url: preview, path: null, file };
    });
    this.fotos.update((list) => [...list, ...nuevas]);
    // primera foto = portada por defecto
    if (!this.portadaKey() && this.fotos().length) this.portadaKey.set(this.fotos()[0].key);
  }

  quitarFoto(item: FotoItem) {
    if (item.file && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
    this.fotos.update((list) => list.filter((f) => f.key !== item.key));
    if (this.portadaKey() === item.key) {
      this.portadaKey.set(this.fotos().length ? this.fotos()[0].key : null);
    }
  }

  marcarPortada(item: FotoItem) {
    this.portadaKey.set(item.key);
  }

  esPortada(item: FotoItem): boolean {
    return this.portadaKey() === item.key;
  }

  abrirLightbox(url: string) {
    this.lightboxUrl.set(url);
  }

  private async cargarFotosExistentes(e: TecEquipo | null): Promise<FotoItem[]> {
    if (!e) return [];
    const paths = e.fotos && e.fotos.length ? e.fotos : e.foto_path ? [e.foto_path] : [];
    const items: FotoItem[] = [];
    for (const p of paths) {
      const url = await this.tecnologia.getEquipoFotoUrl(p);
      if (url) items.push({ key: p, url, path: p, file: null });
    }
    return items;
  }

  // AL1 — agregar un tipo nuevo desde el formulario.
  async guardarTipoNuevo() {
    const label = this.newTipoLabel().trim();
    if (!label) return;
    try {
      const nuevo = await this.tecnologia.addEquipoTipo(label);
      this.tipos.update((list) => [...list, nuevo].sort((a, b) => a.label.localeCompare(b.label)));
      this.form.controls.tipo_id.setValue(nuevo.value);
      this.tipoIdActual.set(nuevo.value);
      this.newTipoLabel.set('');
      this.addingTipo.set(false);
      this.toast.success('Tipo agregado');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar el tipo.');
    }
  }

  // DA7/DA-04 — agregar una situación/condición nueva desde el formulario.
  async guardarEstadoNuevo() {
    const label = this.newEstadoLabel().trim();
    if (!label) return;
    try {
      const nuevo = await this.tecnologia.addEquipoEstado(label);
      this.estados.update((list) => [...list, nuevo]);
      this.form.controls.estado.setValue(nuevo.value);
      this.newEstadoLabel.set('');
      this.addingEstado.set(false);
      this.toast.success('Situación agregada');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar la situación.');
    }
  }

  async guardarCondicionNueva() {
    const label = this.newCondicionLabel().trim();
    if (!label) return;
    try {
      const nuevo = await this.tecnologia.addEquipoCondicion(label);
      this.condiciones.update((list) => [...list, nuevo]);
      this.form.controls.condicion.setValue(nuevo.value);
      this.newCondicionLabel.set('');
      this.addingCondicion.set(false);
      this.toast.success('Condición agregada');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar la condición.');
    }
  }

  // ── Filters ───────────────────────────────────────────────
  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onEstadoChange(value: string) {
    this.selectedEstado.set(value);
  }

  clearFilters() {
    this.searchQuery.set('');
    this.selectedEstado.set('');
    this.soloResponsableExterno.set(false);
    this.soloSinCompra.set(false);
    this.soloSinGarantia.set(false);
  }

  // ── Create/Edit drawer ────────────────────────────────────
  private limpiarFotos() {
    for (const f of this.fotos()) if (f.file && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
    this.fotos.set([]);
    this.portadaKey.set(null);
  }

  openCreate() {
    this.editingId.set(null);
    this.kitPadreIdParaCrear.set(null);
    this.saveError.set('');
    this.addingTipo.set(false);
    this.newTipoLabel.set('');
    this.form.reset({
      nombre: '',
      tipo_id: null,
      marca: null,
      modelo: null,
      serie: null,
      estado: 'en_stock',
      condicion: 'funciona',
      empleado_id: null,
      asignado_en: null,
      bodega_id: null,
      ubicacion: null,
      notas: null,
      costo: null,
      moneda: 'DOP',
      fecha_compra: null,
      garantia_hasta: null,
      origen_solicitud_compra_id: null,
      service_tag: null,
      codigo_servicio: null,
      numero_parte: null,
      modelo_regulatorio: null,
      anio_fabricacion: null,
      codigo_anterior: null,
      imei: null,
      etiqueta_taller: null,
      responsable_externo: null,
      costo_origen: 'compra',
      fecha_compra_desconocida: false,
      garantia_desconocida: false,
    });
    this.specsForm.reset({ accesoriosTexto: '' });
    this.tipoIdActual.set(null);
    this.capturasWindowsPendientes.set([]);
    this.limpiarFotos();
    this.drawerOpen.set(true);
  }

  async openEdit(e: TecEquipo) {
    this.editingId.set(e.id);
    this.saveError.set('');
    this.addingTipo.set(false);
    this.newTipoLabel.set('');
    this.form.reset({
      nombre: e.nombre,
      tipo_id: e.tipo_id,
      marca: e.marca,
      modelo: e.modelo,
      serie: e.serie,
      estado: e.estado,
      condicion: e.condicion ?? 'funciona',
      empleado_id: e.empleado_id,
      asignado_en: e.asignado_en,
      bodega_id: e.bodega_id,
      ubicacion: e.ubicacion,
      notas: e.notas,
      costo: e.costo,
      moneda: e.moneda ?? 'DOP',
      fecha_compra: e.fecha_compra,
      garantia_hasta: e.garantia_hasta,
      origen_solicitud_compra_id: e.origen_solicitud_compra_id,
      service_tag: e.service_tag ?? null,
      codigo_servicio: e.codigo_servicio ?? null,
      numero_parte: e.numero_parte ?? null,
      modelo_regulatorio: e.modelo_regulatorio ?? null,
      anio_fabricacion: e.anio_fabricacion ?? null,
      codigo_anterior: e.codigo_anterior ?? null,
      imei: e.imei ?? null,
      etiqueta_taller: e.etiqueta_taller ?? null,
      responsable_externo: e.responsable_externo ?? null,
      costo_origen: e.costo_origen ?? 'compra',
      fecha_compra_desconocida: e.fecha_compra_desconocida ?? false,
      garantia_desconocida: e.garantia_desconocida ?? false,
    });
    this.tipoIdActual.set(e.tipo_id);
    const specs = e.specs ?? null;
    this.specsForm.reset({
      procesador: specs?.procesador ?? null,
      ram_gb: specs?.ram_gb ?? null,
      ram_velocidad: specs?.ram_velocidad ?? null,
      almacenamiento_tipo: specs?.almacenamiento_tipo ?? null,
      almacenamiento_gb: specs?.almacenamiento_gb ?? null,
      gpu_integrada: specs?.gpu_integrada ?? null,
      gpu_dedicada: specs?.gpu_dedicada ?? null,
      gpu_memoria_gb: specs?.gpu_memoria_gb ?? null,
      so: specs?.so ?? null,
      so_version: specs?.so_version ?? null,
      pantalla_pulgadas: specs?.pantalla_pulgadas ?? null,
      resolucion: specs?.resolucion ?? null,
      tactil: specs?.tactil ?? null,
      nombre_windows: specs?.nombre_windows ?? null,
      usuario_windows: specs?.usuario_windows ?? null,
      cargador_voltaje: specs?.cargador_voltaje ?? null,
      cargador_amperaje: specs?.cargador_amperaje ?? null,
      frecuencia: specs?.frecuencia ?? null,
      potencia_w: specs?.potencia_w ?? null,
      tipo_radio: specs?.tipo_radio ?? null,
      sello_telserdom_radio: specs?.sello_telserdom_radio ?? null,
      sello_telserdom_bateria: specs?.sello_telserdom_bateria ?? null,
      bateria_modelo: specs?.bateria_modelo ?? null,
      bateria_capacidad: specs?.bateria_capacidad ?? null,
      bateria_unidad: specs?.bateria_unidad ?? null,
      bateria_voltaje: specs?.bateria_voltaje ?? null,
      bateria_sello: specs?.bateria_sello ?? null,
      accesoriosTexto: (specs?.accesorios ?? []).join(', '),
      camara_specs: specs?.camara_specs ?? null,
    });
    this.capturasWindowsPendientes.set([]);
    this.limpiarFotos();
    this.drawerOpen.set(true);
    const existentes = await this.cargarFotosExistentes(e);
    this.fotos.set(existentes);
    this.portadaKey.set(
      e.foto_portada ?? (existentes.length ? existentes[0].key : null),
    );
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    this.saveError.set('');

    const payload = this.form.value as unknown as TecEquipoFormData;

    try {
      const id = this.editingId();
      let equipoId: string;
      if (id) {
        await this.tecnologia.updateEquipo(id, payload);
        equipoId = id;
      } else {
        // DA-10 — si viene de "Agregar componente", nace ligado al kit.
        const kitPadreId = this.kitPadreIdParaCrear();
        const created = await this.tecnologia.createEquipo(
          kitPadreId ? { ...payload, kit_padre_id: kitPadreId } : payload,
        );
        equipoId = created.id;
      }

      // AL1 — subir fotos nuevas, componer galería + portada.
      try {
        const finalPaths: string[] = [];
        let portada: string | null = null;
        for (const f of this.fotos()) {
          let path = f.path;
          if (!path && f.file) path = await this.tecnologia.uploadEquipoFoto(equipoId, f.file);
          if (!path) continue;
          finalPaths.push(path);
          if (this.portadaKey() === f.key) portada = path;
        }
        if (!portada) portada = finalPaths[0] ?? null;
        await this.tecnologia.updateEquipo(equipoId, {
          fotos: finalPaths,
          foto_portada: portada,
          foto_path: portada, // back-compat
        });
      } catch {
        this.toast.warning('Fotos no subidas', 'El equipo se guardó, pero las fotos no.');
      }

      // DA2 — specs 1:1 (no-op si el bloque quedó vacío, guardarSpecs lo decide).
      try {
        const specsValue = this.specsForm.getRawValue();
        const { accesoriosTexto, ...resto } = specsValue;
        await this.tecnologia.guardarSpecs(equipoId, {
          ...resto,
          accesorios: accesoriosTexto
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        });
      } catch (e: unknown) {
        this.toast.warning('Specs no guardadas', e instanceof Error ? e.message : 'El equipo se guardó, pero las especificaciones no.');
      }

      // DA-14 — capturas de Windows leídas en esta sesión, guardadas como
      // foto "especificaciones" (se suman a las que ya hubiera, nunca reemplazan).
      if (this.capturasWindowsPendientes().length) {
        try {
          const nuevos = await Promise.all(
            this.capturasWindowsPendientes().map((f) => this.tecnologia.uploadEquipoFotoSpecs(equipoId, f)),
          );
          const previos = id ? (this.equipos().find((e) => e.id === id)?.fotos_specs ?? []) : [];
          await this.tecnologia.updateEquipo(equipoId, { fotos_specs: [...previos, ...nuevos] });
          this.capturasWindowsPendientes.set([]);
        } catch {
          this.toast.warning('Capturas no guardadas', 'El equipo se guardó, pero las capturas de Windows no.');
        }
      }

      await this.loadAll();
      this.toast.success(id ? 'Equipo actualizado' : 'Equipo registrado');
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(e: TecEquipo) {
    if (!confirm(`¿Eliminar el equipo "${e.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.tecnologia.removeEquipo(e.id);
      this.equipos.update((list) => list.filter((x) => x.id !== e.id));
      this.toast.success('Equipo eliminado');
    } catch (err: unknown) {
      this.toast.error(err instanceof Error ? err.message : 'Error al eliminar.');
    }
  }

  // ── Detail / history drawer ───────────────────────────────
  async openDetail(e: TecEquipo) {
    this.detailEquipo.set(e);
    this.detailOpen.set(true);
    this.detalleFotos.set([]);
    this.cotizacionDeEquipo.set(null);
    void this.tecnologia.getCotizacionDeEquipo(e.id).then((c) => this.cotizacionDeEquipo.set(c));
    this.cargarFotosExistentes(e).then((items) => {
      // portada primero
      const portada = e.foto_portada;
      const ordenadas = portada
        ? [...items].sort((a, b) => (a.path === portada ? -1 : b.path === portada ? 1 : 0))
        : items;
      this.detalleFotos.set(ordenadas);
    });
    this.historial.set([]);
    this.historialLoading.set(true);
    try {
      const historial = await this.tecnologia.getHistorial(e.id);
      this.historial.set(historial);
    } catch {
      this.toast.error('No se pudo cargar el historial.');
    } finally {
      this.historialLoading.set(false);
    }
    // DA-10 — componentes del kit (si e.kit_padre_id es null, puede ser un kit padre)
    this.kitComponentes.set([]);
    this.kitEstado.set(null);
    if (!e.kit_padre_id) {
      this.tecnologia.getComponentesDeKit(e.id).then((comps) => this.kitComponentes.set(comps));
      this.tecnologia.getKitEstado(e.id).then((k) => this.kitEstado.set(k));
    }
  }

  // ── DA-10 — Kits ───────────────────────────────────────────
  kitComponentes = signal<TecEquipo[]>([]);
  kitEstado = signal<{ kit_id: string; total_componentes: number; presentes: number; faltantes: number; completo: boolean } | null>(null);

  private async recargarKit(kitId: string) {
    const [comps, estado] = await Promise.all([
      this.tecnologia.getComponentesDeKit(kitId),
      this.tecnologia.getKitEstado(kitId),
    ]);
    this.kitComponentes.set(comps);
    this.kitEstado.set(estado);
  }

  abrirAgregarComponente(kit: TecEquipo) {
    this.closeDetail();
    this.openCreate();
    this.kitPadreIdParaCrear.set(kit.id);
  }

  async toggleComponentePresente(c: TecEquipo) {
    try {
      await this.tecnologia.marcarPresenteComponente(c.id, !c.presente);
      const kit = this.detailEquipo();
      if (kit) await this.recargarKit(kit.id);
      this.toast.success(c.presente ? 'Marcado como faltante' : 'Marcado presente');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }

  async quitarComponenteDelKit(c: TecEquipo) {
    if (!confirm(`¿Sacar "${c.nombre}" del kit? Queda como equipo suelto.`)) return;
    try {
      await this.tecnologia.moverPiezaDeKit(c.id, true);
      const kit = this.detailEquipo();
      if (kit) await this.recargarKit(kit.id);
      this.toast.success('Componente separado del kit');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo separar.');
    }
  }

  async aplicarAlKitCompleto(kit: TecEquipo) {
    if (!confirm('¿Aplicar la ubicación y el responsable actuales del kit a todos sus componentes presentes?')) return;
    try {
      await this.tecnologia.moverKit(kit.id, kit.empleado_id, kit.bodega_id, kit.ubicacion, 'Aplicado desde la ficha del kit');
      await this.recargarKit(kit.id);
      await this.loadAll();
      this.toast.success('Kit movido completo');
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo mover el kit.');
    }
  }

  // ── DA-06 — Clave del equipo (cifrada) ────────────────────
  claveValor = signal<string | null>(null);
  claveTipo = signal<'personal' | 'compartida' | null>(null);
  claveCargando = signal(false);
  claveSegundosRestantes = signal(0);
  claveNuevoTipo = signal<'personal' | 'compartida'>('compartida');
  claveNuevoValor = signal('');
  claveEditando = signal(false);
  private claveTimerId: ReturnType<typeof setInterval> | null = null;

  private limpiarClaveTimer() {
    if (this.claveTimerId) clearInterval(this.claveTimerId);
    this.claveTimerId = null;
  }

  async mostrarClave(equipoId: string) {
    this.claveCargando.set(true);
    try {
      const r = await this.tecnologia.verClaveEquipo(equipoId);
      if (!r.ok || !r.valor) {
        this.toast.error(r.error ?? 'No se pudo mostrar la clave.');
        return;
      }
      this.claveValor.set(r.valor);
      this.claveTipo.set(r.tipo_clave ?? null);
      const segundos = r.visible_segundos ?? 30;
      this.claveSegundosRestantes.set(segundos);
      this.limpiarClaveTimer();
      this.claveTimerId = setInterval(() => {
        this.claveSegundosRestantes.update((s) => {
          if (s <= 1) {
            this.limpiarClaveTimer();
            this.claveValor.set(null);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo mostrar la clave.');
    } finally {
      this.claveCargando.set(false);
    }
  }

  ocultarClave() {
    this.limpiarClaveTimer();
    this.claveValor.set(null);
    this.claveSegundosRestantes.set(0);
  }

  abrirEditarClave() {
    this.claveNuevoTipo.set(this.claveTipo() ?? 'compartida');
    this.claveNuevoValor.set('');
    this.claveEditando.set(true);
  }

  async guardarClave(equipoId: string) {
    const valor = this.claveNuevoValor().trim();
    if (!valor) return;
    this.claveCargando.set(true);
    try {
      const r = await this.tecnologia.guardarClaveEquipo(equipoId, this.claveNuevoTipo(), valor);
      if (!r.ok) {
        this.toast.error(r.error ?? 'No se pudo guardar la clave.');
        return;
      }
      this.claveEditando.set(false);
      this.claveNuevoValor.set('');
      this.toast.success('Clave guardada', 'Se guardó cifrada.');
      const eq = this.detailEquipo();
      if (eq) this.detailEquipo.set({ ...eq, tiene_clave: true });
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la clave.');
    } finally {
      this.claveCargando.set(false);
    }
  }

  async quitarClave(equipoId: string) {
    if (!confirm('¿Quitar la clave guardada de este equipo?')) return;
    this.claveCargando.set(true);
    try {
      const r = await this.tecnologia.quitarClaveEquipo(equipoId);
      if (!r.ok) {
        this.toast.error(r.error ?? 'No se pudo quitar la clave.');
        return;
      }
      this.ocultarClave();
      const eq = this.detailEquipo();
      if (eq) this.detailEquipo.set({ ...eq, tiene_clave: false });
      this.toast.success('Clave eliminada');
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo quitar la clave.');
    } finally {
      this.claveCargando.set(false);
    }
  }

  // ── DA-18 — QR de la etiqueta del equipo ──────────────────
  async imprimirEtiqueta(e: TecEquipo) {
    const url = `${location.origin}/tecnologia/inventario?codigo=${encodeURIComponent(e.codigo ?? '')}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });
    const ventana = window.open('', '_blank', 'width=420,height=520');
    if (!ventana) {
      this.toast.error('El navegador bloqueó la ventana de impresión.');
      return;
    }
    ventana.document.write(`
      <html><head><title>${e.codigo ?? ''}</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 24px; }
        img { width: 220px; height: 220px; }
        h2 { margin: 8px 0 2px; }
        p { margin: 0; color: #555; }
      </style></head>
      <body>
        <img src="${dataUrl}" alt="QR" />
        <h2>${e.codigo ?? ''}</h2>
        <p>${e.nombre}</p>
        <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    ventana.document.close();
  }

  closeDetail() {
    this.limpiarClaveTimer();
    this.claveValor.set(null);
    this.claveEditando.set(false);
    this.detailOpen.set(false);
  }

  // ── Exportar a Excel (listado filtrado) ───────────────────
  async exportar() {
    const rows = this.filtered().map((e) => ({
      'Código': e.codigo ?? '',
      'Nombre': e.nombre,
      'Tipo': this.getTipoLabel(e),
      'Marca': e.marca ?? '',
      'Modelo': e.modelo ?? '',
      'Serie': e.serie ?? '',
      'Situación': this.getEstadoLabel(e.estado),
      'Condición': this.getCondicionLabel(e.condicion ?? 'funciona'),
      'Asignado a': e.empleado ? `${e.empleado.nombre} ${e.empleado.apellido}` : '',
      'Responsable externo': e.responsable_externo ?? '',
      'Ubicación': this.getUbicacionLabel(e),
      'Costo': e.costo ?? '',
      'Origen del costo': e.costo_origen ?? 'compra',
      'Moneda': e.moneda ?? 'DOP',
      'Fecha de compra': e.fecha_compra_desconocida ? 'Desconocida' : this.formatFecha(e.fecha_compra),
      'Garantía hasta': e.garantia_desconocida ? 'Desconocida' : this.formatFecha(e.garantia_hasta),
    }));
    await exportarExcel('inventario-tecnologia', rows);
  }

  get f() {
    return this.form.controls;
  }
}
