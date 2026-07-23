import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { MensajeriaService } from '../../../shared/services/mensajeria.service';
import { UserService } from '../../core/services/user.service';
import { NotificacionesService } from '../../../shared/services/notificaciones.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Conversacion, Mensaje } from '../../../shared/models/mensaje.model';
import { formatFechaMedia } from '../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../shared/ui/paginator/paginator';

@Component({
  selector: 'app-mensajes',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, Skeleton, Paginator],
  templateUrl: './mensajes.html',
  styleUrl: './mensajes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mensajes implements OnInit, OnDestroy {
  private mensajeria = inject(MensajeriaService);
  private userService = inject(UserService);
  private notificaciones = inject(NotificacionesService);
  private toast = inject(ToastService);

  private threadEnd = viewChild<ElementRef<HTMLElement>>('threadEnd');

  miId = this.userService.profile()?.id ?? '';

  conversaciones = signal<Conversacion[]>([]);
  directorio = signal<{ id: string; nombre: string }[]>([]);
  private nombrePorId = new Map<string, string>();

  selectedId = signal<string | null>(null);
  mensajes = signal<Mensaje[]>([]);
  loading = signal(true);
  loadingThread = signal(false);
  sending = signal(false);
  error = signal('');

  searchQuery = signal('');
  composer = new FormControl('');
  pendingFile = signal<File | null>(null);

  // New-conversation drawer
  nuevoOpen = signal(false);
  nuevoModo = signal<'directa' | 'grupo'>('directa');
  grupoNombre = new FormControl('');
  seleccionados = signal<Set<string>>(new Set());
  nuevoBuscar = signal('');
  creating = signal(false);

  private channel: RealtimeChannel | null = null;

  // Auto-scroll: 'auto' (instantáneo) en la carga inicial de un hilo; 'smooth'
  // solo cuando llega/enviamos un mensaje nuevo. Campo plano (no signal) para no
  // volver reactivo el efecto de scroll.
  private nextScrollBehavior: ScrollBehavior = 'auto';

  selectedConv = computed(() => this.conversaciones().find((c) => c.id === this.selectedId()) ?? null);

  conversacionesFiltradas = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.conversaciones();
    return this.conversaciones().filter(
      (c) =>
        (c.tituloMostrado ?? '').toLowerCase().includes(q) ||
        (c.participantes ?? []).some((p) => p.nombre.toLowerCase().includes(q)),
    );
  });

  directorioFiltrado = computed(() => {
    const q = this.nuevoBuscar().toLowerCase().trim();
    return this.directorio()
      .filter((u) => u.id !== this.miId)
      .filter((u) => !q || u.nombre.toLowerCase().includes(q));
  });

  // ── Paginación de listas largas (card lists) ──────────────
  readonly PAGE_SIZE = 15;
  pageConv = signal(1);
  pageDir = signal(1);

  conversacionesPaginadas = computed(() => {
    const start = (this.pageConv() - 1) * this.PAGE_SIZE;
    return this.conversacionesFiltradas().slice(start, start + this.PAGE_SIZE);
  });

  directorioPaginado = computed(() => {
    const start = (this.pageDir() - 1) * this.PAGE_SIZE;
    return this.directorioFiltrado().slice(start, start + this.PAGE_SIZE);
  });

  /** Actualiza el filtro de conversaciones y vuelve a la primera página. */
  onBuscarConv(value: string) {
    this.searchQuery.set(value);
    this.pageConv.set(1);
  }

  /** Actualiza el filtro del directorio y vuelve a la primera página. */
  onBuscarDir(value: string) {
    this.nuevoBuscar.set(value);
    this.pageDir.set(1);
  }

  constructor() {
    // Auto-scroll to the newest message whenever the thread changes. Instant on
    // initial load; smooth only when a new message arrives/is sent.
    effect(() => {
      this.mensajes();
      const behavior = this.nextScrollBehavior;
      queueMicrotask(() => this.threadEnd()?.nativeElement.scrollIntoView({ behavior }));
      this.nextScrollBehavior = 'auto';
    });
  }

  async ngOnInit() {
    await this.loadInitial();
    this.channel = this.mensajeria.subscribeMensajes((m) => this.onRealtimeMensaje(m));
  }

  ngOnDestroy() {
    if (this.channel) void this.mensajeria.unsubscribe(this.channel);
  }

  private async loadInitial() {
    this.loading.set(true);
    this.error.set('');
    try {
      const dir = await this.mensajeria.getDirectorio();
      this.directorio.set(dir);
      this.nombrePorId = new Map(dir.map((u) => [u.id, u.nombre]));
      await this.refreshConversaciones();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la mensajería.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshConversaciones() {
    const convs = await this.mensajeria.getConversaciones(this.miId, this.nombrePorId);
    this.conversaciones.set(convs);
  }

  async selectConversacion(conv: Conversacion) {
    this.selectedId.set(conv.id);
    // QA-033 — al cambiar de conversación, limpia el borrador y el adjunto pendiente
    // para no enviarlos por error a la conversación equivocada.
    this.composer.reset('');
    this.pendingFile.set(null);
    this.loadingThread.set(true);
    try {
      this.mensajes.set(await this.mensajeria.getMensajes(conv.id));
      await this.mensajeria.marcarLeido(conv.id, this.miId);
      // Zero out the unread badge locally + globally.
      this.conversaciones.update((list) =>
        list.map((c) => (c.id === conv.id ? { ...c, noLeidos: 0 } : c)),
      );
      this.notificaciones.refresh();
    } catch (e: unknown) {
      // QA-031 — no silenciar el fallo; avisar al usuario.
      this.toast.error('No se pudo abrir la conversación', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingThread.set(false);
    }
  }

  private async onRealtimeMensaje(m: Mensaje) {
    // Append to the open thread (dedupe — our own sends are added optimistically).
    if (m.conversacion_id === this.selectedId()) {
      if (!this.mensajes().some((x) => x.id === m.id)) {
        const autorNombre = this.nombrePorId.get(m.autor_id) ?? 'Usuario';
        this.nextScrollBehavior = 'smooth';
        this.mensajes.update((list) => [...list, { ...m, autor: { nombre: autorNombre } }]);
      }
      // QA-058 — solo marcar como leído si la pestaña está enfocada; si el usuario
      // no está mirando, el mensaje sigue contando como no leído.
      if (m.autor_id !== this.miId && document.visibilityState === 'visible') {
        await this.mensajeria.marcarLeido(m.conversacion_id, this.miId);
      }
    }
    await this.refreshConversaciones();
    this.notificaciones.refresh();
  }

  onFileSelected(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    this.pendingFile.set(files && files.length > 0 ? files[0] : null);
  }

  clearFile() {
    this.pendingFile.set(null);
  }

  async enviar() {
    const conv = this.selectedConv();
    const texto = this.composer.value?.trim() ?? '';
    const file = this.pendingFile();
    if (!conv || this.sending() || (!texto && !file)) return;

    this.sending.set(true);
    try {
      const m = await this.mensajeria.enviarMensaje(conv.id, this.miId, texto || null, file);
      if (!this.mensajes().some((x) => x.id === m.id)) {
        this.nextScrollBehavior = 'smooth';
        this.mensajes.update((list) => [...list, m]);
      }
      this.composer.reset('');
      this.pendingFile.set(null);
      await this.refreshConversaciones();
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al enviar el mensaje.');
    } finally {
      this.sending.set(false);
    }
  }

  onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.enviar();
    }
  }

  async descargarArchivo(m: Mensaje) {
    if (!m.archivo_path) return;
    try {
      const url = await this.mensajeria.getArchivoUrl(m.archivo_path);
      window.open(url, '_blank');
    } catch (e: unknown) {
      // QA-031 — avisar si no se pudo generar el enlace del archivo.
      this.toast.error('No se pudo abrir el archivo', e instanceof Error ? e.message : undefined);
    }
  }

  /** QA-007 — el nombre del autor se resuelve vía el directorio (nombrePorId), que
   *  no depende del join RLS de `usuarios`; así el historial de grupos muestra el
   *  nombre real y no "Usuario". Cae al join / "Usuario" solo si falta en el mapa. */
  autorNombre(m: Mensaje): string {
    return this.nombrePorId.get(m.autor_id) ?? m.autor?.nombre ?? 'Usuario';
  }

  /** QA-034 — true cuando el mensaje inicia un nuevo día calendario respecto al
   *  anterior (para pintar un separador de fecha en el hilo). */
  esNuevoDia(i: number): boolean {
    const list = this.mensajes();
    if (i <= 0) return true;
    return formatFechaMedia(list[i - 1].created_at) !== formatFechaMedia(list[i].created_at);
  }

  fechaSeparador(ts: string): string {
    return formatFechaMedia(ts);
  }

  // ── New conversation ─────────────────────────────────────
  openNuevo(modo: 'directa' | 'grupo') {
    this.nuevoModo.set(modo);
    this.grupoNombre.reset('');
    this.seleccionados.set(new Set());
    this.nuevoBuscar.set('');
    this.pageDir.set(1);
    this.nuevoOpen.set(true);
  }

  closeNuevo() {
    this.nuevoOpen.set(false);
  }

  toggleSeleccion(id: string) {
    this.seleccionados.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  estaSeleccionado(id: string): boolean {
    return this.seleccionados().has(id);
  }

  async iniciarDirecta(otroId: string) {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const convId = await this.mensajeria.crearDirecta(otroId);
      await this.refreshConversaciones();
      this.nuevoOpen.set(false);
      const conv = this.conversaciones().find((c) => c.id === convId);
      if (conv) await this.selectConversacion(conv);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al iniciar la conversación.');
    } finally {
      this.creating.set(false);
    }
  }

  async crearGrupo() {
    const nombre = this.grupoNombre.value?.trim();
    const ids = [...this.seleccionados()];
    if (!nombre || ids.length === 0 || this.creating()) return;
    this.creating.set(true);
    try {
      const convId = await this.mensajeria.crearGrupo(nombre, ids);
      await this.refreshConversaciones();
      this.nuevoOpen.set(false);
      const conv = this.conversaciones().find((c) => c.id === convId);
      if (conv) await this.selectConversacion(conv);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al crear el grupo.');
    } finally {
      this.creating.set(false);
    }
  }

  esMio(m: Mensaje): boolean {
    return m.autor_id === this.miId;
  }

  iniciales(nombre: string): string {
    return nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
}
