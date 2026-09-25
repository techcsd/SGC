import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CombustibleService, LogCombustibleRow, RegistroCombustibleHistorial, PermisoRetro, EchadaPorAprobar } from '../../../../shared/services/combustible.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ConductoresService } from '../../../../shared/services/conductores.service';
import { Vehiculo, identificacionVehiculo } from '../../../../shared/models/vehiculo.model';
import { RegistroCombustible, PRODUCTO_CANONICO_LABEL, RENDIMIENTO_ESTADO_META } from '../../../../shared/models/combustible.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { formatFechaDisplay, formatHoraTimestamp, formatFechaHoraDisplay, todayIso, daysAgoIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Icon } from '../../../../shared/ui/icon/icon';

/** BQ5 — campos editables (whitelist alineada con el RPC editar_echada). */
type CampoEditable = 'vehiculo_id' | 'estacion' | 'fecha' | 'galones' | 'monto' | 'kilometraje' | 'producto';

/**
 * AF17 — Registro/log de echadas para admin y roles elevados. Sirve para detectar
 * kilometrajes irreales: muestra el delta de km vs la echada anterior, quién
 * registró cada echada y resalta los saltos fuera de umbral (km_alerta).
 */
@Component({
  selector: 'app-combustible-log',
  imports: [FlotaSubnav, DecimalPipe, ReactiveFormsModule, RouterLink, Skeleton, DateRangeFilter, FormDrawer, Lightbox, Icon],
  templateUrl: './combustible-log.html',
  styleUrl: './combustible-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CombustibleLog implements OnInit {
  private combustibleService = inject(CombustibleService);
  private vehiculosService = inject(VehiculosService);
  private conductoresService = inject(ConductoresService);
  private route = inject(ActivatedRoute);
  private datosPruebaView = inject(DatosPruebaViewService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private fb = inject(FormBuilder);

  formatFecha = formatFechaDisplay;
  formatFechaHora = formatFechaHoraDisplay;
  readonly idVehiculo = identificacionVehiculo;

  // BQ5 — la edición/saneamiento de echadas la gestiona flota-elevado (mismo
  // predicado que editar_echada / echadas_sospechosas en el servidor).
  esFlotaElevado = computed(() =>
    ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica'].some((r) => this.userService.hasRole(r)),
  );

  // BB6 — la echada muestra fecha Y hora. El día viene de `fecha` (lo que el usuario
  // eligió); la hora, del `created_at` (timestamptz del registro). Formato: dd/mm hh:mm.
  fechaHora(r: { fecha?: string | null; created_at?: string | null }): string {
    const dia = this.formatFecha(r.fecha);
    const hora = r.created_at ? formatHoraTimestamp(r.created_at) : '';
    return hora && hora !== '—' ? `${dia} · ${hora}` : dia;
  }

  // AQ13 — chips de periodo rápido (además del rango manual). dias hacia atrás.
  readonly CHIPS: { label: string; dias: number }[] = [
    { label: '1D', dias: 0 },
    { label: '1S', dias: 6 },
    { label: '1M', dias: 29 },
    { label: '3M', dias: 89 },
    { label: '6M', dias: 179 },
    { label: '1A', dias: 364 },
  ];
  chipActivo = signal<number | null>(null);

  rows = signal<LogCombustibleRow[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  // AT14/AT26 — datos de prueba fuera del selector de filtro para no-admin.
  vehiculosVisibles = computed(() => this.datosPruebaView.visibles(this.vehiculos()));
  usuarios = signal<{ id: string; nombre: string }[]>([]);
  loading = signal(true);
  error = signal('');

  // Filtros
  vehiculoId = signal('');
  usuarioId = signal('');
  desde = signal('');
  hasta = signal('');

  saltos = computed(() => this.rows().filter((r) => r.km_alerta).length);

  // BV1 — permisos de registro retroactivo (panel para flota-elevado/admin).
  mostrarPermisos = signal(false);
  permisosRetro = signal<PermisoRetro[]>([]);
  permisoUsuario = signal('');
  permisoDias = signal(7);
  permisoVence = signal('');
  permisoMotivo = signal('');
  permisoSaving = signal(false);

  async ngOnInit() {
    try {
      const [vehiculos, usuarios, conductores] = await Promise.all([
        this.vehiculosService.getAll(),
        this.conductoresService.getUsuariosVinculables().catch(() => []),
        this.conductoresService.getAll().catch(() => []),
      ]);
      this.vehiculos.set(vehiculos);
      this.usuarios.set(usuarios);
      // BX2 — mapa conductor_id → nombre, para que el historial NUNCA muestre un uuid.
      this.conductoresMap.set(new Map(conductores.map((c) => [c.id, c.nombre])));
    } catch { /* filtros opcionales */ }
    if (this.esFlotaElevado()) { void this.cargarPermisos(); void this.cargarPorAprobar(); }
    await this.cargar();
    // BY1 — deep-link ?revision=en_espera abre directamente la pestaña Por aprobar.
    if (this.route.snapshot.queryParamMap.get('revision') === 'en_espera') this.setVista('aprobar');

    // AQ6/AQ13 — deep-link desde la notificación de consumo anormal: ?echada=<id>
    const echadaId = this.route.snapshot.queryParamMap.get('echada');
    if (echadaId) this.abrirDetallePorId(echadaId);
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const rows = await this.combustibleService.getLog({
        desde: this.desde() || null,
        hasta: this.hasta() || null,
        vehiculoId: this.vehiculoId() || null,
        usuarioId: this.usuarioId() || null,
      });
      this.rows.set(rows);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el registro.');
    } finally {
      this.loading.set(false);
    }
  }

  onRango(r: RangoFecha) {
    this.chipActivo.set(null); // rango manual → ningún chip activo
    this.desde.set(r.desde ?? '');
    this.hasta.set(r.hasta ?? '');
    this.cargar();
  }
  // AQ13 — chip de periodo rápido: fija el rango [hoy-dias, hoy] y recarga.
  aplicarChip(c: { label: string; dias: number }) {
    this.chipActivo.set(c.dias);
    this.desde.set(c.dias === 0 ? todayIso() : daysAgoIso(c.dias));
    this.hasta.set(todayIso());
    this.cargar();
  }
  // ── BV1 — panel de permisos retroactivos ────────────────────────────────────
  togglePermisos() { this.mostrarPermisos.update((v) => !v); }
  async cargarPermisos() {
    try {
      this.permisosRetro.set(await this.combustibleService.listarPermisosRetro());
    } catch { /* sin permisos no es error */ }
  }
  async otorgarPermiso() {
    if (this.permisoSaving()) return;
    if (!this.permisoUsuario()) { this.toast.warning('Elige el usuario'); return; }
    if (!this.permisoVence()) { this.toast.warning('Indica el vencimiento del permiso'); return; }
    this.permisoSaving.set(true);
    try {
      await this.combustibleService.otorgarPermisoRetro(
        this.permisoUsuario(), this.permisoDias(), this.permisoVence(), this.permisoMotivo().trim() || null,
      );
      this.toast.success('Permiso otorgado', 'El usuario ya puede registrar echadas con fecha pasada.');
      this.permisoUsuario.set(''); this.permisoMotivo.set('');
      await this.cargarPermisos();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo otorgar el permiso');
    } finally {
      this.permisoSaving.set(false);
    }
  }
  async revocarPermiso(id: string) {
    try {
      await this.combustibleService.revocarPermisoRetro(id);
      this.toast.success('Permiso revocado');
      await this.cargarPermisos();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo revocar el permiso');
    }
  }

  onVehiculo(v: string) { this.vehiculoId.set(v); this.cargar(); }
  onUsuario(v: string) { this.usuarioId.set(v); this.cargar(); }
  limpiar() {
    this.chipActivo.set(null);
    this.vehiculoId.set(''); this.usuarioId.set(''); this.desde.set(''); this.hasta.set('');
    this.cargar();
  }

  productoLabel(r: LogCombustibleRow): string {
    if (!r.producto) return '—';
    const sub = r.subtipo ? ` ${r.subtipo}` : '';
    return `${r.producto}${sub}`;
  }

  // ── AG6 — detalle clicable de la echada (con estación + 3 fotos) ──
  detailOpen = signal(false);
  detail = signal<RegistroCombustible | null>(null);
  detailLoading = signal(false);
  fotoRecibo = signal<string | null>(null);
  fotoTablero = signal<string | null>(null);
  fotoBomba = signal<string | null>(null);
  lightbox = signal<string | null>(null);
  readonly PRODUCTO_LABEL = PRODUCTO_CANONICO_LABEL;
  readonly RENDIMIENTO_META = RENDIMIENTO_ESTADO_META;

  // ── BY1 — zona de espera / aprobación ────────────────────────────────────────
  vista = signal<'registro' | 'aprobar'>('registro');
  porAprobar = signal<EchadaPorAprobar[]>([]);
  loadingAprobar = signal(false);
  aprobandoId = signal<string | null>(null);
  // Modal de rechazo (motivo obligatorio).
  rechazoId = signal<string | null>(null);
  rechazoMotivo = signal('');
  rechazoSaving = signal(false);
  // El drawer de edición sirve también para "Aprobar con corrección".
  modoAprobar = signal(false);
  // El Registro NO mezcla las que están en espera (van a "Por aprobar").
  rowsRegistro = computed(() => this.rows().filter((r) => r.revision !== 'en_espera'));

  setVista(v: 'registro' | 'aprobar') { this.vista.set(v); if (v === 'aprobar') void this.cargarPorAprobar(); }

  async cargarPorAprobar() {
    if (!this.esFlotaElevado()) return;
    this.loadingAprobar.set(true);
    try { this.porAprobar.set(await this.combustibleService.echadasPorAprobar()); }
    catch { /* informativo */ }
    finally { this.loadingAprobar.set(false); }
  }

  revisionChip(rev: string | null | undefined): { label: string; badge: string } | null {
    switch (rev) {
      case 'en_espera': return { label: 'EN ESPERA', badge: 'warning' };
      case 'aprobada': return { label: 'APROBADA', badge: 'success' };
      case 'rechazada': return { label: 'RECHAZADA', badge: 'danger' };
      default: return null;
    }
  }

  async aprobar(id: string) {
    if (this.aprobandoId()) return;
    this.aprobandoId.set(id);
    try {
      await this.combustibleService.aprobarEchada(id);
      this.toast.success('Echada aprobada', 'Ya cuenta en los tableros y se avisó al chofer.');
      await Promise.all([this.cargarPorAprobar(), this.cargar()]);
      if (this.detail()?.id === id) this.cerrarDetalle();
    } catch (e) { this.toast.errorFrom(e, 'No se pudo aprobar'); }
    finally { this.aprobandoId.set(null); }
  }

  /** Abre el drawer de edición en modo "aprobar con corrección". */
  aprobarConCorreccion(r: RegistroCombustible) {
    this.modoAprobar.set(true);
    this.abrirEditar(r);
  }

  abrirRechazo(id: string) { this.rechazoId.set(id); this.rechazoMotivo.set(''); }
  cerrarRechazo() { this.rechazoId.set(null); }
  async confirmarRechazo() {
    const id = this.rechazoId();
    const motivo = this.rechazoMotivo().trim();
    if (!id) return;
    if (motivo.length < 3) { this.toast.warning('Escribe el motivo del rechazo'); return; }
    this.rechazoSaving.set(true);
    try {
      await this.combustibleService.rechazarEchada(id, motivo);
      this.toast.success('Echada rechazada', 'Se avisó al chofer con el motivo.');
      this.rechazoId.set(null);
      await Promise.all([this.cargarPorAprobar(), this.cargar()]);
      if (this.detail()?.id === id) this.cerrarDetalle();
    } catch (e) { this.toast.errorFrom(e, 'No se pudo rechazar'); }
    finally { this.rechazoSaving.set(false); }
  }

  abrirDetalle(row: LogCombustibleRow) { return this.abrirDetallePorId(row.id); }

  // AQ13/AQ6 — abre el detalle por id (row-click o deep-link ?echada=<id>).
  async abrirDetallePorId(id: string) {
    this.detailOpen.set(true);
    this.detail.set(null);
    this.fotoRecibo.set(null);
    this.fotoTablero.set(null);
    this.fotoBomba.set(null);
    this.detailLoading.set(true);
    try {
      const r = await this.combustibleService.getById(id);
      this.detail.set(r);
      if (r?.foto_recibo_path) this.combustibleService.getFotoUrl(r.foto_recibo_path).then((u) => this.fotoRecibo.set(u));
      if (r?.foto_tablero_path) this.combustibleService.getFotoUrl(r.foto_tablero_path).then((u) => this.fotoTablero.set(u));
      if (r?.foto_bomba_path) this.combustibleService.getFotoUrl(r.foto_bomba_path).then((u) => this.fotoBomba.set(u));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el detalle.');
      this.detailOpen.set(false);
    } finally {
      this.detailLoading.set(false);
    }
  }

  cerrarDetalle() { this.detailOpen.set(false); }
  verFoto(url: string | null) { if (url) this.lightbox.set(url); }

  rendimientoMeta(r: RegistroCombustible | null) {
    return r?.estado ? this.RENDIMIENTO_META[r.estado] : null;
  }

  async exportar() {
    const rows = this.rows().map((r) => ({
      Fecha: this.formatFecha(r.fecha),
      Hora: r.created_at ? formatHoraTimestamp(r.created_at) : '',
      Vehículo: r.placa ?? '',
      Lectura: r.kilometraje ?? '',
      'Δ km': r.km_recorridos ?? '',
      Galones: r.galones ?? '',
      Monto: r.monto ?? '',
      Combustible: this.productoLabel(r),
      Registró: r.registrado_nombre ?? '',
      Conductor: r.conductor_nombre ?? '',
      'Salto km': r.km_alerta ? 'SÍ' : '',
      'Sin asignación': r.sin_asignacion ? 'SÍ' : '',
    }));
    await exportarExcel('registro-combustible', rows);
  }

  /** BR1 — "Revisar" desde el chip KM ALERTA / SIN ASIGNACIÓN: abre el detalle
   *  (superficie de revisión con el botón Editar de BQ5). */
  revisar(r: LogCombustibleRow, ev: Event) {
    ev.stopPropagation();
    this.abrirDetalle(r);
  }

  // ── BQ5 — Editar echada (drawer, solo flota-elevado) ──
  editOpen = signal(false);
  editSaving = signal(false);
  editError = signal('');
  editId = signal<string | null>(null);
  historial = signal<RegistroCombustibleHistorial[]>([]);
  historialLoading = signal(false);

  readonly PRODUCTO_OPCIONES = [
    { value: 'gasolina', label: 'Gasolina' },
    { value: 'diesel', label: 'Diésel' },
  ];
  // BX2 — mapa conductor_id → nombre (para no exponer uuid en el historial).
  conductoresMap = signal<Map<string, string>>(new Map());

  // BQ5/BX2 — SOLO campos de negocio se listan en el historial, con etiqueta humana.
  // Los campos de sistema (saneada*, valor_original, rendimiento*, ids, timestamps) NO
  // se listan: se resumen en una línea humana (resumenSistema) o quedan en el detalle
  // técnico (solo desarrollador). Regla 16 + AT11.
  readonly CAMPO_LABEL: Record<string, string> = {
    vehiculo_id: 'Vehículo', estacion: 'Estación', fecha: 'Fecha',
    galones: 'Galones', monto: 'Monto', kilometraje: 'Kilometraje', producto: 'Combustible',
    conductor_id: 'Conductor',
  };
  // Campos de negocio que se muestran (allowlist). El resto no se pinta crudo.
  private readonly CAMPOS_NEGOCIO = Object.keys(this.CAMPO_LABEL);
  // Roles internos → nombre legible para las líneas del historial.
  private readonly ROL_LEGIBLE: Record<string, string> = {
    admin: 'Administración', jefe_flota: 'Jefe de Flota', logistica: 'Logística',
    gerencia: 'Gerencia', direccion: 'Dirección', desarrollador: 'Developer',
    tecnologia: 'Tecnología', encargado_tecnologia: 'Encargado de Tecnología',
  };

  editForm = this.fb.group({
    vehiculo_id: [''],
    estacion: [''],
    fecha: ['', Validators.required],
    galones: [null as number | null],
    monto: [null as number | null],
    kilometraje: [null as number | null],
    producto: [''],
    motivo: ['', [Validators.required, Validators.minLength(3)]],
  });

  /** Abre el drawer de edición precargando los valores actuales de la echada. */
  async abrirEditar(r: RegistroCombustible) {
    if (!this.esFlotaElevado()) return;
    this.editError.set('');
    this.editId.set(r.id);
    this.editForm.reset({
      vehiculo_id: r.vehiculo_id ?? '',
      estacion: r.estacion ?? '',
      fecha: r.fecha ?? '',
      galones: r.galones,
      monto: r.monto,
      kilometraje: r.kilometraje,
      producto: r.producto ?? '',
      motivo: '',
    });
    this.editOpen.set(true);
    this.cargarHistorial(r.id);
  }

  cerrarEditar() { this.editOpen.set(false); this.modoAprobar.set(false); }

  private async cargarHistorial(id: string) {
    this.historialLoading.set(true);
    this.historial.set([]);
    try {
      this.historial.set(await this.combustibleService.historialEchada(id));
    } catch { /* el historial es informativo; no bloquea la edición */ }
    finally { this.historialLoading.set(false); }
  }

  /** Guarda solo los campos que cambiaron respecto al detalle cargado. */
  async guardarEdicion() {
    const id = this.editId();
    const original = this.detail();
    if (!id || !original) return;
    if (this.editForm.invalid) { this.editForm.markAllAsTouched(); return; }

    const v = this.editForm.getRawValue();
    const propuesto: Record<CampoEditable, unknown> = {
      vehiculo_id: v.vehiculo_id || null,
      estacion: v.estacion?.trim() || null,
      fecha: v.fecha || null,
      galones: v.galones,
      monto: v.monto,
      kilometraje: v.kilometraje,
      producto: v.producto || null,
    };

    // Solo enviar las claves realmente cambiadas.
    const cambios: Record<string, unknown> = {};
    (Object.keys(propuesto) as CampoEditable[]).forEach((k) => {
      const antes = (original as unknown as Record<string, unknown>)[k] ?? null;
      const despues = propuesto[k] ?? null;
      if (String(antes) !== String(despues)) cambios[k] = despues;
    });

    if (Object.keys(cambios).length === 0) {
      this.toast.warning('Sin cambios', 'No modificaste ningún campo.');
      return;
    }

    this.editSaving.set(true);
    this.editError.set('');
    try {
      if (this.modoAprobar()) {
        // BY1 — aprobar con corrección: aplica los cambios y da el visto bueno en un paso.
        await this.combustibleService.aprobarEchada(id, v.motivo!.trim(), cambios);
        this.toast.success('Echada aprobada con corrección', 'Ya cuenta en los tableros y se avisó al chofer.');
        void this.cargarPorAprobar();
      } else {
        await this.combustibleService.editarEchada(id, cambios, v.motivo!.trim());
        this.toast.success('Echada actualizada', 'Se recalcularon los derivados y se guardó la traza.');
      }
      this.editForm.markAsPristine();
      this.editOpen.set(false);
      this.modoAprobar.set(false);
      // Re-lee el detalle con sus joins (el RPC devuelve la fila cruda) y la lista.
      try { this.detail.set(await this.combustibleService.getById(id)); } catch { /* no crítico */ }
      await this.cargar();                  // refresca la lista (derivados/estado)
    } catch (e: unknown) {
      this.editError.set(e instanceof Error ? e.message : 'No se pudo guardar la edición.');
    } finally {
      this.editSaving.set(false);
    }
  }

  /** BX2 — SOLO los campos de negocio que cambiaron, con etiqueta y valor humanos. */
  cambiosNegocio(h: RegistroCombustibleHistorial): { campo: string; antes: string; despues: string }[] {
    const antes = (h.antes ?? {}) as Record<string, unknown>;
    const despues = (h.despues ?? {}) as Record<string, unknown>;
    const out: { campo: string; antes: string; despues: string }[] = [];
    for (const k of this.CAMPOS_NEGOCIO) {
      const a = antes[k] ?? null;
      const d = despues[k] ?? null;
      if (String(a) !== String(d)) {
        out.push({ campo: this.CAMPO_LABEL[k], antes: this.fmtCampo(k, a), despues: this.fmtCampo(k, d) });
      }
    }
    return out;
  }

  /** BX2 — cambios de SISTEMA resumidos en lenguaje humano (nada de uuid/ISO/jsonb). */
  resumenSistema(h: RegistroCombustibleHistorial): string[] {
    const antes = (h.antes ?? {}) as Record<string, unknown>;
    const despues = (h.despues ?? {}) as Record<string, unknown>;
    const out: string[] = [];
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    if (!antes['saneada'] && despues['saneada']) {
      const rol = this.rolLegible(String(despues['saneada_como_rol'] ?? h.editado_como_rol ?? ''));
      out.push(`Marcada como saneada por ${this.editorNombre(h)}${rol ? ` (${rol})` : ''}`);
    }
    const rA = num(antes['rendimiento_km_gal']); const rD = num(despues['rendimiento_km_gal']);
    if (rA !== rD && (rA != null || rD != null)) {
      out.push(`Rendimiento recalculado: ${rA ?? '—'} → ${rD ?? '—'} km/gal`);
    }
    const pA = num(antes['precio_por_galon']); const pD = num(despues['precio_por_galon']);
    if (pA !== pD && (pA != null || pD != null)) {
      out.push(`Precio/galón recalculado: ${pA ?? '—'} → ${pD ?? '—'}`);
    }
    const kA = num(antes['km_recorridos']); const kD = num(despues['km_recorridos']);
    if (kA !== kD && (kA != null || kD != null)) {
      out.push(`Δ km recalculado: ${kA ?? '—'} → ${kD ?? '—'} km`);
    }
    return out;
  }

  /** BX2 — detalle técnico crudo (SOLO desarrollador, regla 16): todas las claves. */
  detalleTecnico(h: RegistroCombustibleHistorial): { campo: string; antes: string; despues: string }[] {
    const antes = (h.antes ?? {}) as Record<string, unknown>;
    const despues = (h.despues ?? {}) as Record<string, unknown>;
    const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const out: { campo: string; antes: string; despues: string }[] = [];
    claves.forEach((k) => {
      const a = antes[k] ?? null; const d = despues[k] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(d)) {
        out.push({ campo: k, antes: this.crudo(a), despues: this.crudo(d) });
      }
    });
    return out;
  }
  esDesarrollador = computed(() => this.userService.esDesarrollador());

  private crudo(val: unknown): string {
    if (val === null || val === undefined) return '—';
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  }

  rolLegible(codigo: string): string {
    const c = (codigo || '').trim();
    return c ? (this.ROL_LEGIBLE[c] ?? c) : '';
  }

  /** Valor de un campo de negocio en lenguaje humano (RD$, gal, km, fecha, nombres). */
  private fmtCampo(campo: string, val: unknown): string {
    if (val === null || val === undefined || val === '') return '—';
    switch (campo) {
      case 'fecha': return this.formatFecha(String(val));
      case 'galones': return `${Number(val)} gal`;
      case 'kilometraje': return `${Number(val).toLocaleString('es-DO')} km`;
      case 'monto': return `RD$ ${Number(val).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      case 'vehiculo_id': {
        const veh = this.vehiculos().find((x) => x.id === val);
        return veh ? this.idVehiculo(veh) : 'otro vehículo';
      }
      case 'conductor_id': return this.conductoresMap().get(String(val)) ?? 'otro conductor';
      case 'producto':
        return this.PRODUCTO_OPCIONES.find((p) => p.value === val)?.label
          ?? this.PRODUCTO_LABEL[String(val)] ?? String(val);
      default: return String(val);
    }
  }

  editorNombre(h: RegistroCombustibleHistorial): string {
    return h.editor?.nombre?.trim() || 'Usuario';
  }
}
