import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  WhatsappCompaService,
  WhatsappAutorizado,
  WhatsappMensaje,
  WhatsappMensajeEstado,
  WhatsappEstadoEdge,
  WhatsappEstadoResumen,
  normalizarTelefonoWhatsapp,
} from '../../../../shared/services/whatsapp-compa.service';
import {
  WaGruposService,
  WaGrupo,
  WaGrupoModo,
  WaMensajeGrupo,
  WaMensajeBusqueda,
  WaMensajeTipo,
  WaHallazgo,
  WaHallazgoTipo,
  WaHallazgoEstado,
  WaListenerEstado,
  WaEvento,
  WaUsoIaDia,
  WaConfig,
} from '../../../../shared/services/wa-grupos.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { parsearChatWhatsapp, WaChatImportResultado } from '../../../../shared/utils/wa-chat-import.util';
import { resaltarFragmentoHtml } from '../../../../shared/utils/wa-fragmento.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { Icon } from '../../../../shared/ui/icon/icon';
import { IconName } from '../../../../shared/ui/icon/icons';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { BarChart, BarDatum } from '../../../../shared/ui/bar-chart/bar-chart';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';
import {
  formatFechaHoraDisplay,
  formatFechaRelativa,
  formatFechaDisplay,
  todayIso,
  daysAgoIso,
} from '../../../../shared/utils/fecha.util';

type Tab = 'autorizados' | 'actividad' | 'estado' | 'grupos' | 'hallazgos' | 'archivo';

/** DB2 — etiquetas/explicaciones de los 3 modos de un grupo (AT11/BS2: nunca un
 *  valor crudo sin traducir al humano que lo va a tocar). */
const MODO_LABEL: Record<WaGrupoModo, string> = { memoria: 'Memoria', consulta: 'Consulta', ignorar: 'Ignorar' };
const MODO_EXPLICACION: Record<WaGrupoModo, string> = {
  memoria: 'Se guarda el mensaje y la IA extrae hallazgos automáticamente (acuerdos, pedidos, montos…).',
  consulta: 'Además de guardar, el grupo puede preguntarle a Compa — responde SOLO con el archivo de ESE grupo.',
  ignorar: 'No se guarda nada de este grupo (defensa extra, además del filtro del listener).',
};

const HALLAZGO_TIPO_LABEL: Record<WaHallazgoTipo, string> = {
  acuerdo: 'Acuerdo',
  tarea: 'Tarea',
  pedido_material: 'Pedido de material',
  incidente: 'Incidente',
  decision: 'Decisión',
  monto: 'Monto',
  fecha_limite: 'Fecha límite',
  cambio_de_plan: 'Cambio de plan',
  pregunta_abierta: 'Pregunta abierta',
  contacto: 'Contacto',
  otro: 'Otro',
};

const HALLAZGO_ESTADO_LABEL: Record<WaHallazgoEstado, string> = {
  nuevo: 'Nuevo',
  revisado: 'Revisado',
  descartado: 'Descartado',
  convertido: 'Convertido',
};

const LISTENER_ESTADO_LABEL: Record<WaListenerEstado['estado'], string> = {
  conectado: 'Conectado',
  esperando_qr: 'Esperando QR',
  desconectado: 'Desconectado',
  sesion_cerrada: 'Sesión cerrada',
  posible_baneo: 'Posible baneo',
};

/** Icono (AW12 — SVG, nunca emoji) por tipo de mensaje; usado como chip de
 *  "adjunto" en el Archivo (no hay preview real — ver nota en el reporte). */
const MEDIA_ICON: Record<WaMensajeTipo, IconName> = {
  texto: 'message-circle',
  imagen: 'image',
  audio: 'mic',
  video: 'play',
  documento: 'file-text',
  sticker: 'square',
  ubicacion: 'map',
  contacto: 'users',
  otro: 'paperclip',
};

type ConvertirTipo = 'tarea' | 'requisicion' | 'nota';
const CONVERTIR_RUTA: Record<ConvertirTipo, string> = {
  tarea: '/tareas/gestion',
  requisicion: '/inventario/requisiciones',
  nota: '/notas/nueva',
};
const CONVERTIR_LABEL: Record<ConvertirTipo, string> = {
  tarea: 'Tareas',
  requisicion: 'Requisiciones',
  nota: 'Notas',
};

/** Resumen por estado, usado solo para los no-desarrolladores (BS2): nunca el
 *  texto crudo del error, siempre una frase humana derivada del `estado`. */
const ESTADO_LABEL: Record<WhatsappMensajeEstado, string> = {
  recibido: 'Recibido',
  procesando: 'Procesando',
  respondido: 'Respondido',
  no_autorizado: 'No autorizado',
  ignorado: 'Ignorado',
  error: 'Error del sistema',
  entregado: 'Entregado',
  leido: 'Leído',
  fallido: 'No se pudo entregar',
};

const ESTADO_TONO: Record<WhatsappMensajeEstado, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  recibido: 'info',
  procesando: 'info',
  respondido: 'success',
  no_autorizado: 'warning',
  ignorado: 'neutral',
  error: 'danger',
  entregado: 'success',
  leido: 'success',
  fallido: 'danger',
};

/**
 * DC7 — Tecnología › Compa en WhatsApp. Gestiona el canal WhatsApp Cloud API
 * (whitelist, bitácora de mensajes y estado de los secretos del edge
 * `whatsapp-webhook`). Backend ya construido y probado esta ronda (ver
 * sql/2026-10-29-dc2-whatsapp-cloud-api.sql, sql/2026-09-04-bj2-…,
 * supabase/functions/whatsapp-webhook) — esta pantalla es SOLO lectura/CRUD web.
 * Pantalla SOLO web (ver PARIDAD.md, Ronda DC) — sin equivalente en csd-app.
 */
@Component({
  selector: 'app-tec-whatsapp',
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    Icon,
    Skeleton,
    FormDrawer,
    ConfirmDialog,
    UserPicker,
    FilterSelect,
    DateRangeFilter,
    ErrorState,
    FileUpload,
    BarChart,
    StaggerDirective,
  ],
  templateUrl: './whatsapp.html',
  styleUrl: './whatsapp.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecWhatsapp implements OnInit {
  private service = inject(WhatsappCompaService);
  private waService = inject(WaGruposService);
  private proyectosService = inject(ProyectosService);
  private toast = inject(ToastService);
  private users = inject(UserService);
  private i18n = inject(I18nService);
  private sanitizer = inject(DomSanitizer);

  readonly estadoLabel = ESTADO_LABEL;
  readonly estadoTono = ESTADO_TONO;
  readonly fmtFechaHora = formatFechaHoraDisplay;
  readonly fmtRelativa = formatFechaRelativa;
  readonly fmtFecha = formatFechaDisplay;
  readonly webhookUrl = this.service.webhookUrl();

  readonly modoLabel = MODO_LABEL;
  readonly modoExplicacion = MODO_EXPLICACION;
  readonly hallazgoTipoLabel = HALLAZGO_TIPO_LABEL;
  readonly hallazgoEstadoLabel = HALLAZGO_ESTADO_LABEL;
  readonly listenerEstadoLabel = LISTENER_ESTADO_LABEL;
  readonly mediaIconMap = MEDIA_ICON;
  readonly convertirRuta = CONVERTIR_RUTA;
  readonly convertirLabel = CONVERTIR_LABEL;
  readonly LIMITE_IMPORT_BYTES = 20 * 1024 * 1024;

  esDesarrollador = this.users.esDesarrollador;
  // DB-S10 — reactivo: hasRole() lee un signal interno, por eso se envuelve en
  // computed() en vez de capturar un booleano fijo en el momento de construir
  // el componente (el perfil puede terminar de cargar después).
  esAdmin = computed(() => this.users.hasRole('admin'));

  tab = signal<Tab>('autorizados');

  ngOnInit() {
    void this.cargarAutorizados();
    void this.cargarMensajes();
    void this.cargarEstado();
    void this.cargarGrupos();
    void this.cargarHallazgos();
  }

  irA(t: Tab) {
    this.tab.set(t);
  }

  // ── Autorizados ──────────────────────────────────────────────────────────
  autorizados = signal<WhatsappAutorizado[]>([]);
  cargandoAutorizados = signal(true);
  errorAutorizados = signal<unknown>(null);

  async cargarAutorizados() {
    this.cargandoAutorizados.set(true);
    this.errorAutorizados.set(null);
    try {
      this.autorizados.set(await this.service.listarAutorizados());
    } catch (e) {
      this.errorAutorizados.set(e);
    } finally {
      this.cargandoAutorizados.set(false);
    }
  }

  addOpen = signal(false);
  addUsuario = signal<UserPickerSelection | null>(null);
  addTelefono = signal('');
  addNota = signal('');
  addGuardando = signal(false);

  abrirAgregar() {
    this.addUsuario.set(null);
    this.addTelefono.set('');
    this.addNota.set('');
    this.addOpen.set(true);
  }

  async onUsuarioElegido(sel: UserPickerSelection) {
    this.addUsuario.set(sel);
    if (!sel.usuario_id) return;
    try {
      const tel = await this.service.telefonoDeUsuario(sel.usuario_id);
      if (tel) this.addTelefono.set(tel);
    } catch {
      /* el campo queda editable a mano si no se pudo prellenar */
    }
  }

  async guardarAutorizado() {
    const sel = this.addUsuario();
    const tel = normalizarTelefonoWhatsapp(this.addTelefono());
    if (!sel?.usuario_id || !tel) return;
    this.addGuardando.set(true);
    try {
      const creadoPor = this.users.profile()?.id ?? null;
      await this.service.crearAutorizado(sel.usuario_id, tel, this.addNota().trim() || null, creadoPor);
      this.toast.success(this.i18n.t('Listo'), this.i18n.t('{nombre} ya puede escribirle a Compa por WhatsApp.', { nombre: sel.nombre }));
      this.addOpen.set(false);
      await this.cargarAutorizados();
    } catch (e) {
      const codigo = (e as { code?: string })?.code;
      if (codigo === '23505') {
        this.toast.error(
          this.i18n.t('Ese número ya está autorizado'),
          this.i18n.t('Edita la fila existente en la lista en vez de crear otra.'),
        );
      } else {
        this.toast.errorFrom(e, this.i18n.t('No se pudo autorizar el número'));
      }
    } finally {
      this.addGuardando.set(false);
    }
  }

  async toggleActivo(a: WhatsappAutorizado) {
    try {
      await this.service.actualizarAutorizado(a.telefono, { activo: !a.activo });
      await this.cargarAutorizados();
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo cambiar el interruptor'));
    }
  }

  notaEditando = signal<string | null>(null);
  notaBorrador = signal('');

  editarNota(a: WhatsappAutorizado) {
    this.notaEditando.set(a.telefono);
    this.notaBorrador.set(a.nota ?? '');
  }

  cancelarNota() {
    this.notaEditando.set(null);
    this.notaBorrador.set('');
  }

  async guardarNota(a: WhatsappAutorizado) {
    try {
      await this.service.actualizarAutorizado(a.telefono, { nota: this.notaBorrador().trim() || null });
      this.notaEditando.set(null);
      await this.cargarAutorizados();
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo guardar la nota'));
    }
  }

  confirmEliminarAbierto = signal(false);
  autorizadoAEliminar = signal<WhatsappAutorizado | null>(null);

  pedirEliminar(a: WhatsappAutorizado) {
    this.autorizadoAEliminar.set(a);
    this.confirmEliminarAbierto.set(true);
  }

  async confirmarEliminar() {
    const a = this.autorizadoAEliminar();
    this.confirmEliminarAbierto.set(false);
    if (!a) return;
    try {
      await this.service.eliminarAutorizado(a.telefono);
      this.toast.success(
        this.i18n.t('Quitado'),
        this.i18n.t('{nombre} ya no puede escribirle a Compa por WhatsApp.', { nombre: a.usuario_nombre }),
      );
      await this.cargarAutorizados();
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo quitar el acceso'));
    } finally {
      this.autorizadoAEliminar.set(null);
    }
  }

  // ── Actividad ────────────────────────────────────────────────────────────
  mensajes = signal<WhatsappMensaje[]>([]);
  cargandoMensajes = signal(true);
  errorMensajes = signal<unknown>(null);

  readonly estadoOptions: FilterOption[] = Object.entries(ESTADO_LABEL).map(([value, label]) => ({ value, label }));

  filtroTexto = signal('');
  filtroEstado = signal<string | null>(null);
  filtroDesde = signal<string | null>(null);
  filtroHasta = signal<string | null>(null);

  async cargarMensajes() {
    this.cargandoMensajes.set(true);
    this.errorMensajes.set(null);
    try {
      this.mensajes.set(
        await this.service.listarMensajes({
          estado: this.filtroEstado(),
          desde: this.filtroDesde(),
          hasta: this.filtroHasta(),
        }),
      );
    } catch (e) {
      this.errorMensajes.set(e);
    } finally {
      this.cargandoMensajes.set(false);
    }
  }

  setFiltroEstado(v: string) {
    this.filtroEstado.set(v || null);
    void this.cargarMensajes();
  }

  setRangoFecha(r: RangoFecha) {
    this.filtroDesde.set(r.desde);
    this.filtroHasta.set(r.hasta);
    void this.cargarMensajes();
  }

  /** Búsqueda por teléfono o nombre: client-side sobre la página ya cargada
   *  (igual criterio que otras bandejas de Tecnología, p. ej. Consultas de Compa). */
  mensajesVisibles = computed(() => {
    const q = this.filtroTexto().trim().toLowerCase();
    if (!q) return this.mensajes();
    return this.mensajes().filter(
      (m) => m.telefono.includes(q) || (m.usuario_nombre ?? '').toLowerCase().includes(q),
    );
  });

  expandido = signal<string | null>(null);
  conversacion = signal<WhatsappMensaje[]>([]);
  cargandoConversacion = signal(false);

  async toggleExpandir(m: WhatsappMensaje) {
    if (this.expandido() === m.id) {
      this.expandido.set(null);
      this.conversacion.set([]);
      return;
    }
    this.expandido.set(m.id);
    this.cargandoConversacion.set(true);
    try {
      this.conversacion.set(await this.service.conversacionDe(m));
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo cargar la conversación'));
    } finally {
      this.cargandoConversacion.set(false);
    }
  }

  // ── Estado ───────────────────────────────────────────────────────────────
  estadoEdge = signal<WhatsappEstadoEdge | null>(null);
  estadoResumen = signal<WhatsappEstadoResumen | null>(null);
  cargandoEstado = signal(true);
  errorEstado = signal<unknown>(null);
  copiado = signal(false);

  // DB2 — heartbeat del listener externo, eventos, uso de IA y config (grupos).
  waListenerEstados = signal<WaListenerEstado[]>([]);
  waEventos = signal<WaEvento[]>([]);
  waUsoIaDiario = signal<WaUsoIaDia[]>([]);
  waConfig = signal<WaConfig | null>(null);
  /** Secretos de `wa-ingest`/`wa-extract` (memoria de grupos) — DISTINTO del
   *  `estadoEdge()` de arriba, que es el de `whatsapp-webhook` (canal 1:1). */
  waSecretos = signal<Record<string, boolean> | null>(null);

  async cargarEstado() {
    this.cargandoEstado.set(true);
    this.errorEstado.set(null);
    try {
      const [edge, resumen, listeners, eventos, usoIa, config, waSecretos] = await Promise.all([
        this.service.estadoEdge(),
        this.service.resumenEstado(),
        // DB2 — best-effort: si alguna de estas falla (p. ej. el listener nunca
        // reportó aún), no debe tumbar el resto de la pestaña Estado.
        this.waService.listenerEstado().catch(() => []),
        this.waService.eventosRecientes(20).catch(() => []),
        this.waService.usoIaDiario(daysAgoIso(13), todayIso()).catch(() => []),
        this.waService.configGlobal().catch(() => null),
        this.waService.secretosEstado().catch(() => null),
      ]);
      this.estadoEdge.set(edge);
      this.estadoResumen.set(resumen);
      this.waListenerEstados.set(listeners);
      this.waEventos.set(eventos);
      this.waUsoIaDiario.set(usoIa);
      this.waConfig.set(config);
      this.waSecretos.set(waSecretos);
    } catch (e) {
      this.errorEstado.set(e);
    } finally {
      this.cargandoEstado.set(false);
    }
  }

  secretosLista = computed(() => Object.entries(this.estadoEdge()?.secretos ?? {}));
  waSecretosLista = computed(() => Object.entries(this.waSecretos() ?? {}));

  async copiarWebhookUrl() {
    try {
      await navigator.clipboard.writeText(this.webhookUrl);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar'), this.i18n.t('Selecciona el texto manualmente.'));
    }
  }

  /** Verde/ámbar/rojo derivado de `estado` + qué tan viejo es el último latido
   *  (mismo lenguaje visual que el resto de la pestaña Estado: nunca jerga). */
  listenerSalud(l: WaListenerEstado): 'success' | 'warning' | 'danger' {
    if (l.estado === 'esperando_qr') return 'warning';
    if (l.estado !== 'conectado') return 'danger';
    const minutos = (Date.now() - new Date(l.ultimo_latido_en).getTime()) / 60000;
    if (minutos > 15) return 'danger';
    if (minutos > 7) return 'warning';
    return 'success';
  }

  eventoTono(nivel: WaEvento['nivel']): 'info' | 'warning' | 'danger' {
    return nivel === 'critico' ? 'danger' : nivel === 'alerta' ? 'warning' : 'info';
  }

  usoIaBars = computed<BarDatum[]>(() => {
    const porFuncion = new Map<string, number>();
    for (const r of this.waUsoIaDiario()) {
      porFuncion.set(r.funcion, (porFuncion.get(r.funcion) ?? 0) + r.tokens_in + r.tokens_out);
    }
    return [...porFuncion.entries()].map(([label, value]) => ({ label, value }));
  });

  usoIaCostoTotal = computed(() => this.waUsoIaDiario().reduce((acc, r) => acc + (r.costo_estimado ?? 0), 0));
  usoIaCostoTotalFmt = computed(() => `$${this.usoIaCostoTotal().toFixed(2)}`);

  // ── Grupos (DB2) ─────────────────────────────────────────────────────────
  grupos = signal<WaGrupo[]>([]);
  cargandoGrupos = signal(true);
  errorGrupos = signal<unknown>(null);
  proyectos = signal<Proyecto[]>([]);

  async cargarGrupos() {
    this.cargandoGrupos.set(true);
    this.errorGrupos.set(null);
    try {
      const [grupos, proyectos] = await Promise.all([
        this.waService.listarGrupos(),
        // Best-effort: el picker de proyecto es un plus, no debe tumbar la lista de grupos.
        this.proyectosService.getAll().catch(() => []),
      ]);
      this.grupos.set(grupos);
      this.proyectos.set(proyectos);
    } catch (e) {
      this.errorGrupos.set(e);
    } finally {
      this.cargandoGrupos.set(false);
    }
  }

  proyectoOptions = computed<FilterOption[]>(() => this.proyectos().map((p) => ({ value: p.id, label: p.nombre })));

  grupoOptions = computed<FilterOption[]>(() => this.grupos().map((g) => ({ value: g.jid, label: g.nombre || g.jid })));

  async cambiarModoGrupo(g: WaGrupo, modo: string) {
    const anterior = g.modo;
    const nuevo = modo as WaGrupoModo;
    this.grupos.update((gs) => gs.map((x) => (x.jid === g.jid ? { ...x, modo: nuevo } : x)));
    try {
      await this.waService.actualizarGrupo(g.jid, { modo: nuevo });
    } catch (e) {
      this.grupos.update((gs) => gs.map((x) => (x.jid === g.jid ? { ...x, modo: anterior } : x)));
      this.toast.errorFrom(e, this.i18n.t('No se pudo cambiar el modo del grupo'));
    }
  }

  async cambiarProyectoGrupo(g: WaGrupo, proyectoId: string) {
    const anterior = g.proyecto_id;
    const nuevo = proyectoId || null;
    this.grupos.update((gs) => gs.map((x) => (x.jid === g.jid ? { ...x, proyecto_id: nuevo } : x)));
    try {
      await this.waService.actualizarGrupo(g.jid, { proyecto_id: nuevo });
    } catch (e) {
      this.grupos.update((gs) => gs.map((x) => (x.jid === g.jid ? { ...x, proyecto_id: anterior } : x)));
      this.toast.errorFrom(e, this.i18n.t('No se pudo vincular el proyecto'));
    }
  }

  // ── Hallazgos (DB2) ──────────────────────────────────────────────────────
  hallazgos = signal<WaHallazgo[]>([]);
  cargandoHallazgos = signal(true);
  errorHallazgos = signal<unknown>(null);

  filtroHallazgoGrupo = signal<string | null>(null);
  filtroHallazgoTipo = signal<string | null>(null);
  filtroHallazgoEstado = signal<string | null>('nuevo');
  filtroHallazgoDesde = signal<string | null>(null);
  filtroHallazgoHasta = signal<string | null>(null);
  filtroHallazgoPersona = signal('');

  readonly hallazgoTipoOptions: FilterOption[] = Object.entries(HALLAZGO_TIPO_LABEL).map(([value, label]) => ({ value, label }));
  readonly hallazgoEstadoOptions: FilterOption[] = Object.entries(HALLAZGO_ESTADO_LABEL).map(([value, label]) => ({ value, label }));

  async cargarHallazgos() {
    this.cargandoHallazgos.set(true);
    this.errorHallazgos.set(null);
    try {
      const base = await this.waService.listarHallazgos({
        grupo_jid: this.filtroHallazgoGrupo(),
        tipo: this.filtroHallazgoTipo(),
        estado: this.filtroHallazgoEstado(),
        desde: this.filtroHallazgoDesde(),
        hasta: this.filtroHallazgoHasta(),
      });
      // Una sola consulta extra para traer `personas` de TODO el lote (no N+1):
      // el listado RPC no las incluye (está pensado también para Compa/MCP).
      const personasMap = base.length ? await this.waService.personasDeHallazgos(base.map((h) => h.id)) : {};
      this.hallazgos.set(base.map((h) => ({ ...h, personas: personasMap[h.id] ?? [] })));
    } catch (e) {
      this.errorHallazgos.set(e);
    } finally {
      this.cargandoHallazgos.set(false);
    }
  }

  setFiltroHallazgoGrupo(v: string) {
    this.filtroHallazgoGrupo.set(v || null);
    void this.cargarHallazgos();
  }
  setFiltroHallazgoTipo(v: string) {
    this.filtroHallazgoTipo.set(v || null);
    void this.cargarHallazgos();
  }
  setFiltroHallazgoEstado(v: string) {
    this.filtroHallazgoEstado.set(v || null);
    void this.cargarHallazgos();
  }
  setRangoHallazgo(r: RangoFecha) {
    this.filtroHallazgoDesde.set(r.desde);
    this.filtroHallazgoHasta.set(r.hasta);
    void this.cargarHallazgos();
  }

  /** Filtro por persona: client-side sobre `personas` (jsonb), ya cargado en el lote. */
  hallazgosVisibles = computed(() => {
    const q = this.filtroHallazgoPersona().trim().toLowerCase();
    if (!q) return this.hallazgos();
    return this.hallazgos().filter((h) =>
      (h.personas ?? []).some((p) => (p.nombre ?? '').toLowerCase().includes(q) || (p.telefono ?? '').includes(q)),
    );
  });

  /** Confianza como indicador, nunca como verdad absoluta (BS2) — de ahí "estimada". */
  confianzaPct(h: WaHallazgo): number | null {
    return h.confianza === null || h.confianza === undefined ? null : Math.round(h.confianza * 100);
  }
  confianzaTono(h: WaHallazgo): 'success' | 'warning' | 'danger' {
    const pct = this.confianzaPct(h) ?? 0;
    return pct >= 75 ? 'success' : pct >= 40 ? 'warning' : 'danger';
  }

  expandidoHallazgo = signal<string | null>(null);
  mensajesFuente = signal<WaMensajeGrupo[]>([]);
  cargandoMensajesFuente = signal(false);

  async toggleExpandirHallazgo(h: WaHallazgo) {
    if (this.expandidoHallazgo() === h.id) {
      this.expandidoHallazgo.set(null);
      this.mensajesFuente.set([]);
      return;
    }
    this.expandidoHallazgo.set(h.id);
    this.mensajesFuente.set([]);
    this.cargandoMensajesFuente.set(true);
    try {
      const detalle = await this.waService.detalleHallazgo(h.id);
      this.mensajesFuente.set(await this.waService.mensajesPorIds(detalle.mensaje_ids));
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudieron cargar los mensajes de origen'));
    } finally {
      this.cargandoMensajesFuente.set(false);
    }
  }

  async marcarHallazgo(h: WaHallazgo, estado: WaHallazgoEstado) {
    try {
      await this.waService.actualizarHallazgo(h.id, { estado });
      this.hallazgos.update((hs) => hs.map((x) => (x.id === h.id ? { ...x, estado } : x)));
      this.toast.success(
        this.i18n.t('Listo'),
        estado === 'revisado' ? this.i18n.t('Hallazgo marcado como revisado.') : this.i18n.t('Hallazgo descartado.'),
      );
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo actualizar el hallazgo'));
    }
  }

  editandoHallazgo = signal<string | null>(null);
  resumenBorrador = signal('');
  detalleBorrador = signal('');

  editarHallazgo(h: WaHallazgo) {
    this.editandoHallazgo.set(h.id);
    this.resumenBorrador.set(h.resumen);
    this.detalleBorrador.set(h.detalle ?? '');
  }
  cancelarEdicionHallazgo() {
    this.editandoHallazgo.set(null);
  }
  async guardarEdicionHallazgo(h: WaHallazgo) {
    const resumen = this.resumenBorrador().trim();
    if (!resumen) return;
    const detalle = this.detalleBorrador().trim() || null;
    try {
      await this.waService.actualizarHallazgo(h.id, { resumen, detalle });
      this.hallazgos.update((hs) => hs.map((x) => (x.id === h.id ? { ...x, resumen, detalle } : x)));
      this.editandoHallazgo.set(null);
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo guardar el resumen'));
    }
  }

  // ── Convertir hallazgo → tarea/requisición/nota (manual, BS2) ───────────
  // No existe en el repo un mecanismo de "crear X prefilled from Y" por query
  // params/router state (se buscó: "crear issue desde reporte" en Jira llama
  // directo a un RPC server-side con el id, no navega con datos prellenados).
  // Como aquí NO hay un id de tarea/requisición/nota que crear por RPC (eso
  // vive en otros módulos, cada uno con su propio flujo), la opción honesta es:
  // copiar el texto armado, abrir el módulo destino en pestaña nueva, y dejar
  // que la persona confirme ella misma que ya lo creó — nunca asumir que se
  // creó solo porque se abrió la pantalla.
  convertirOpen = signal(false);
  convertirHallazgoSel = signal<WaHallazgo | null>(null);
  convertirTipo = signal<ConvertirTipo>('tarea');
  convertirCopiado = signal(false);

  abrirConvertir(h: WaHallazgo) {
    this.convertirHallazgoSel.set(h);
    this.convertirTipo.set(h.tipo === 'pedido_material' ? 'requisicion' : 'tarea');
    this.convertirCopiado.set(false);
    this.convertirOpen.set(true);
  }

  textoParaConvertir = computed(() => {
    const h = this.convertirHallazgoSel();
    if (!h) return '';
    const partes = [h.resumen];
    if (h.detalle) partes.push(h.detalle);
    if (h.fecha_mencionada) partes.push(`Fecha mencionada: ${formatFechaDisplay(h.fecha_mencionada)}`);
    if (h.monto) partes.push(`Monto: ${h.monto}${h.moneda ? ' ' + h.moneda : ''}`);
    partes.push(`(Del grupo de WhatsApp "${h.grupo_nombre}")`);
    return partes.join('\n');
  });

  async copiarTextoConvertir() {
    try {
      await navigator.clipboard.writeText(this.textoParaConvertir());
      this.convertirCopiado.set(true);
      setTimeout(() => this.convertirCopiado.set(false), 2000);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar'), this.i18n.t('Selecciona el texto manualmente.'));
    }
  }

  async confirmarConvertido() {
    const h = this.convertirHallazgoSel();
    if (!h) return;
    try {
      await this.waService.actualizarHallazgo(h.id, { estado: 'convertido', convertido_a: this.convertirTipo() });
      this.hallazgos.update((hs) => hs.map((x) => (x.id === h.id ? { ...x, estado: 'convertido' as const } : x)));
      this.toast.success(this.i18n.t('Listo'), this.i18n.t('Hallazgo marcado como convertido.'));
      this.convertirOpen.set(false);
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo marcar como convertido'));
    }
  }

  // ── Archivo (DB2) ────────────────────────────────────────────────────────
  archivoConsulta = signal('');
  archivoGrupo = signal<string | null>(null);
  archivoDesde = signal<string | null>(null);
  archivoHasta = signal<string | null>(null);
  archivoResultados = signal<WaMensajeBusqueda[]>([]);
  cargandoArchivo = signal(false);
  errorArchivo = signal<unknown>(null);
  buscadoArchivo = signal(false);

  async buscarArchivo() {
    const q = this.archivoConsulta().trim();
    if (!q) {
      this.archivoResultados.set([]);
      this.buscadoArchivo.set(false);
      return;
    }
    this.cargandoArchivo.set(true);
    this.errorArchivo.set(null);
    this.buscadoArchivo.set(true);
    try {
      this.archivoResultados.set(
        await this.waService.buscarMensajes({
          consulta: q,
          grupo_jid: this.archivoGrupo(),
          desde: this.archivoDesde(),
          hasta: this.archivoHasta(),
        }),
      );
    } catch (e) {
      this.errorArchivo.set(e);
    } finally {
      this.cargandoArchivo.set(false);
    }
  }

  setArchivoGrupo(v: string) {
    this.archivoGrupo.set(v || null);
    if (this.buscadoArchivo()) void this.buscarArchivo();
  }
  setRangoArchivo(r: RangoFecha) {
    this.archivoDesde.set(r.desde);
    this.archivoHasta.set(r.hasta);
    if (this.buscadoArchivo()) void this.buscarArchivo();
  }

  fragmentoHtml(frag: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(resaltarFragmentoHtml(frag));
  }

  mediaIcon(tipo: WaMensajeTipo): IconName {
    return MEDIA_ICON[tipo] ?? 'paperclip';
  }

  expandidoArchivo = signal<string | null>(null);
  detalleArchivo = signal<WaMensajeGrupo | null>(null);
  cargandoDetalleArchivo = signal(false);

  async toggleDetalleArchivo(r: WaMensajeBusqueda) {
    if (this.expandidoArchivo() === r.id) {
      this.expandidoArchivo.set(null);
      this.detalleArchivo.set(null);
      return;
    }
    this.expandidoArchivo.set(r.id);
    this.detalleArchivo.set(null);
    this.cargandoDetalleArchivo.set(true);
    try {
      this.detalleArchivo.set(await this.waService.detalleMensaje(r.id));
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo cargar el mensaje'));
    } finally {
      this.cargandoDetalleArchivo.set(false);
    }
  }

  /** URL firmada de corta duración (300s) para ver el adjunto — el front nunca
   *  accede al bucket `wa-media` directo (sin policies de cliente). */
  cargandoPreviewMedia = signal(false);
  async verVistaPreviaMedia(waMessageId: string) {
    this.cargandoPreviewMedia.set(true);
    try {
      const { url } = await this.waService.urlMedia(waMessageId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      this.toast.errorFrom(e, this.i18n.t('No se pudo generar la vista previa'));
    } finally {
      this.cargandoPreviewMedia.set(false);
    }
  }

  // ── DB-S10 — importar historial (.txt), solo admin ──────────────────────
  importarOpen = signal(false);
  importarArchivo = signal<File | null>(null);
  importarGrupoJid = signal<string | null>(null);
  importarResultado = signal<WaChatImportResultado | null>(null);
  importarErrorMsg = signal<string | null>(null);
  importarProcesando = signal(false);
  importarGuardando = signal(false);

  abrirImportar() {
    this.importarArchivo.set(null);
    this.importarGrupoJid.set(null);
    this.importarResultado.set(null);
    this.importarErrorMsg.set(null);
    this.importarOpen.set(true);
  }

  async onArchivoImportar(files: File[]) {
    const f = files[0];
    if (!f) return;
    this.importarErrorMsg.set(null);
    if (f.size > this.LIMITE_IMPORT_BYTES) {
      this.importarErrorMsg.set(this.i18n.t('El archivo pesa más de 20 MB. Divide el export en partes más pequeñas.'));
      return;
    }
    this.importarArchivo.set(f);
    this.importarResultado.set(null);
    this.importarProcesando.set(true);
    try {
      const texto = await f.text();
      const resultado = parsearChatWhatsapp(texto);
      if (!resultado.mensajes.length) {
        this.importarErrorMsg.set(
          this.i18n.t('No se reconoció ningún mensaje en este archivo. Verifica que sea un .txt exportado de WhatsApp.'),
        );
      }
      this.importarResultado.set(resultado);
    } catch {
      this.importarErrorMsg.set(this.i18n.t('No se pudo leer el archivo.'));
    } finally {
      this.importarProcesando.set(false);
    }
  }

  quitarArchivoImportar() {
    this.importarArchivo.set(null);
    this.importarResultado.set(null);
    this.importarErrorMsg.set(null);
  }

  /** Estimado grueso (caracteres de texto / 4), NUNCA presentado como cifra
   *  exacta — solo para que quien importa tenga una idea del costo de IA antes
   *  de confirmar (wa-extract procesará este lote como cualquier mensaje nuevo). */
  estimadoTokens = computed(() => {
    const r = this.importarResultado();
    if (!r) return 0;
    const chars = r.mensajes.reduce((acc, m) => acc + (m.texto?.length ?? 0), 0);
    return Math.ceil(chars / 4);
  });

  async confirmarImportar() {
    const r = this.importarResultado();
    const grupoJid = this.importarGrupoJid();
    if (!r || !grupoJid || !r.mensajes.length) return;
    this.importarGuardando.set(true);
    try {
      const n = await this.waService.importarMensajes(grupoJid, r.mensajes);
      this.toast.success(this.i18n.t('Importado'), this.i18n.t('{n} mensajes guardados.', { n: String(n) }));
      this.importarOpen.set(false);
      if (this.buscadoArchivo()) void this.buscarArchivo();
    } catch (e) {
      // DB-S10 — `wa_importar_mensajes` ya existe (sql/2026-11-05-db2-whatsapp-
      // grupos.sql §15); este catch es el fallback honesto si falla por otro
      // motivo (permiso, red, etc). Nunca se le muestra al usuario el error
      // técnico crudo (BS2): se explica la causa real en lenguaje llano.
      this.toast.errorFrom(e, this.i18n.t('No se pudo importar el historial'));
    } finally {
      this.importarGuardando.set(false);
    }
  }
}
