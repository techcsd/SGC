import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { Icon } from '../../../../shared/ui/icon/icon';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { FilterSelect, FilterOption } from '../../../../shared/ui/filter-select/filter-select';
import { DateRangeFilter, RangoFecha } from '../../../../shared/ui/date-range-filter/date-range-filter';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { StaggerDirective } from '../../../../shared/motion/stagger.directive';
import { formatFechaHoraDisplay, formatFechaRelativa } from '../../../../shared/utils/fecha.util';

type Tab = 'autorizados' | 'actividad' | 'estado';

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
    TranslatePipe,
    Icon,
    Skeleton,
    FormDrawer,
    ConfirmDialog,
    UserPicker,
    FilterSelect,
    DateRangeFilter,
    ErrorState,
    StaggerDirective,
  ],
  templateUrl: './whatsapp.html',
  styleUrl: './whatsapp.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecWhatsapp implements OnInit {
  private service = inject(WhatsappCompaService);
  private toast = inject(ToastService);
  private users = inject(UserService);
  private i18n = inject(I18nService);

  readonly estadoLabel = ESTADO_LABEL;
  readonly estadoTono = ESTADO_TONO;
  readonly fmtFechaHora = formatFechaHoraDisplay;
  readonly fmtRelativa = formatFechaRelativa;
  readonly webhookUrl = this.service.webhookUrl();

  esDesarrollador = this.users.esDesarrollador;

  tab = signal<Tab>('autorizados');

  ngOnInit() {
    void this.cargarAutorizados();
    void this.cargarMensajes();
    void this.cargarEstado();
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

  async cargarEstado() {
    this.cargandoEstado.set(true);
    this.errorEstado.set(null);
    try {
      const [edge, resumen] = await Promise.all([this.service.estadoEdge(), this.service.resumenEstado()]);
      this.estadoEdge.set(edge);
      this.estadoResumen.set(resumen);
    } catch (e) {
      this.errorEstado.set(e);
    } finally {
      this.cargandoEstado.set(false);
    }
  }

  secretosLista = computed(() => Object.entries(this.estadoEdge()?.secretos ?? {}));

  async copiarWebhookUrl() {
    try {
      await navigator.clipboard.writeText(this.webhookUrl);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar'), this.i18n.t('Selecciona el texto manualmente.'));
    }
  }
}
