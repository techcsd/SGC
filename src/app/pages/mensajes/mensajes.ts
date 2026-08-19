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
import { DatePipe, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { MensajeriaService } from '../../../shared/services/mensajeria.service';
import { UserService } from '../../core/services/user.service';
import { NotificacionesService } from '../../../shared/services/notificaciones.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Conversacion, EstadoMensaje, Mensaje, PresenciaAccion, Recibo, StickerPack } from '../../../shared/models/mensaje.model';
import { formatFechaMedia, timestampLocalIso, todayIso, daysAgoIso } from '../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { GrupoInfoPanel } from './grupo-info/grupo-info';
import { Img } from '../../../shared/components/img/img';
import { Lightbox } from '../../../shared/ui/lightbox/lightbox';
import { VoicePlayer } from '../../../shared/ui/voice-player/voice-player';

@Component({
  selector: 'app-mensajes',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe, UpperCasePipe, NgTemplateOutlet, Skeleton, Paginator, GrupoInfoPanel, Img, Lightbox, VoicePlayer],
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
  // AT14 — marca de lectura previa del usuario al abrir la conversación (límite
  // para "no leídos"). Capturada ANTES de marcar como leído.
  lastReadAt = signal<string | null>(null);
  // AT15 — thumbnails firmados de imágenes adjuntas, por id de mensaje.
  thumbUrls = signal<Map<string, string>>(new Map());
  // AT15 — imagen abierta en el lightbox (URL a tamaño completo, ya firmada).
  lightbox = signal<string | null>(null);
  loading = signal(true);
  loadingThread = signal(false);
  sending = signal(false);
  error = signal('');

  searchQuery = signal('');
  composer = new FormControl('');
  pendingFile = signal<File | null>(null);

  // ── AW15 — notas de voz (grabar/enviar/reproducir en la web) ──────────────
  grabando = signal(false);
  grabSegundos = signal(0);
  nivel = signal(0); // 0..1 amplitud del micrófono (UI reactiva al ruido)
  audioUrls = signal<Map<string, string>>(new Map()); // URL firmada por id de mensaje-audio
  private mediaRecorder: MediaRecorder | null = null;
  private grabChunks: Blob[] = [];
  private grabStream: MediaStream | null = null;
  private grabInicio = 0;
  private grabTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private nivelRaf = 0;
  private cancelarEnvio = false;

  // ── AT16 — stickers ──────────────────────────────────────
  stickerPickerOpen = signal(false);
  stickerPacks = signal<StickerPack[]>([]);
  stickerRecientes = signal<string[]>([]);
  stickerTab = signal<string>('recientes'); // 'recientes' | id de pack
  stickerLoading = signal(false);
  stickerUploading = signal(false);
  private stickersCargados = false;

  /** Packs ordenados: el/los de sistema primero (p.ej. "Básico"), luego por `orden`. */
  stickerPacksOrdenados = computed(() =>
    [...this.stickerPacks()].sort((a, b) => {
      if (a.es_sistema !== b.es_sistema) return a.es_sistema ? -1 : 1;
      return a.orden - b.orden;
    }),
  );

  /** Stickers del pack activo (vacío cuando la pestaña activa es "recientes"). */
  stickerPackActivo = computed<StickerPack | null>(() => {
    const tab = this.stickerTab();
    if (tab === 'recientes') return null;
    return this.stickerPacks().find((p) => p.id === tab) ?? null;
  });

  // Group-info drawer
  grupoInfoOpen = signal(false);
  selectedAvatarUrl = signal<string | null>(null);

  // New-conversation drawer
  nuevoOpen = signal(false);
  nuevoModo = signal<'directa' | 'grupo'>('directa');
  grupoNombre = new FormControl('');
  seleccionados = signal<Set<string>>(new Set());
  nuevoBuscar = signal('');
  creating = signal(false);

  private channel: RealtimeChannel | null = null;

  // ── AV5 — recibos (✓/✓✓/azul) + presencia (escribiendo/grabando) ──────────
  recibos = signal<Recibo[]>([]);
  /** Texto de presencia del OTRO ("Ana está escribiendo…"), '' si nadie. */
  presenciaTexto = signal<string>('');
  private recibosCh: RealtimeChannel | null = null;
  private presenciaCh: RealtimeChannel | null = null;
  private presenciaTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private presenciaNombres = new Map<string, PresenciaAccion>();
  private typingUltimo = 0;
  private typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  private miNombre = '';
  private reconcileHandler = () => { if (document.visibilityState === 'visible') void this.reconciliarHilo(); };

  // ── AY14 — visor de PDF inline ────────────────────────────
  pdfViewer = signal<{ url: string; safe: SafeResourceUrl; nombre: string } | null>(null);
  private sanitizer = inject(DomSanitizer);

  // Auto-scroll: 'auto' (instantáneo) en la carga inicial de un hilo; 'smooth'
  // solo cuando llega/enviamos un mensaje nuevo. Campo plano (no signal) para no
  // volver reactivo el efecto de scroll.
  private nextScrollBehavior: ScrollBehavior = 'auto';
  // AT14 — cuando se abre una conversación con mensajes no leídos, el próximo
  // scroll va al separador "Mensajes no leídos" en vez del final del hilo.
  private scrollToUnreadPending = false;

  selectedConv = computed(() => this.conversaciones().find((c) => c.id === this.selectedId()) ?? null);

  /** AT14 — id del primer mensaje no leído (recibido después de `lastReadAt`),
   *  frontera para pintar el divisor "Mensajes no leídos". null si no hay. */
  primerNoLeidoId = computed<string | null>(() => {
    const lr = this.lastReadAt();
    if (!lr) return null;
    for (const m of this.mensajes()) {
      if (m.autor_id !== this.miId && m.tipo !== 'sistema' && m.created_at > lr) return m.id;
    }
    return null;
  });

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
      const toUnread = this.scrollToUnreadPending;
      this.scrollToUnreadPending = false;
      queueMicrotask(() => {
        // AT14 — al abrir una conversación con no leídos, posiciona el hilo en el
        // separador "Mensajes no leídos". En cualquier otro caso (carga sin no
        // leídos, o llegada/envío de un mensaje) baja al final.
        if (toUnread) {
          const sep = document.querySelector('.thread__messages .msg-unread-sep');
          if (sep) {
            sep.scrollIntoView({ behavior, block: 'start' });
            return;
          }
        }
        this.threadEnd()?.nativeElement.scrollIntoView({ behavior });
      });
      this.nextScrollBehavior = 'auto';
    });
  }

  async ngOnInit() {
    this.miNombre = this.userService.profile()?.nombre ?? 'Alguien';
    await this.loadInitial();
    this.channel = this.mensajeria.subscribeMensajes((m) => this.onRealtimeMensaje(m));
    // AY16 — al volver a la pestaña, reconcilia el hilo abierto (por si el realtime
    // se perdió un mensaje mientras estaba en background → dos pantallas dispares).
    document.addEventListener('visibilitychange', this.reconcileHandler);
  }

  ngOnDestroy() {
    if (this.channel) void this.mensajeria.unsubscribe(this.channel);
    this.cerrarCanalesConv();
    document.removeEventListener('visibilitychange', this.reconcileHandler);
    this.limpiarGrabacion(); // AW15 — libera micrófono/timer si quedó grabando
  }

  /** Cierra los canales de la conversación abierta (recibos + presencia). */
  private cerrarCanalesConv() {
    if (this.recibosCh) { void this.mensajeria.unsubscribe(this.recibosCh); this.recibosCh = null; }
    if (this.presenciaCh) { void this.mensajeria.unsubscribe(this.presenciaCh); this.presenciaCh = null; }
    for (const t of this.presenciaTimers.values()) clearTimeout(t);
    this.presenciaTimers.clear();
    this.presenciaNombres.clear();
    this.presenciaTexto.set('');
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
    // AT14 — captura mi marca de lectura previa (frontera de "no leídos") ANTES de
    // marcar como leído, para saber dónde pintar el divisor "Mensajes no leídos".
    const miPart = (conv.participantes ?? []).find((p) => p.usuario_id === this.miId);
    this.lastReadAt.set(miPart?.last_read_at ?? null);
    void this.loadSelectedAvatar(conv);
    this.loadingThread.set(true);
    try {
      this.mensajes.set(await this.mensajeria.getMensajes(conv.id));
      // AT14 — si hay un primer no leído, el próximo scroll va a ese divisor.
      this.scrollToUnreadPending = this.primerNoLeidoId() !== null;
      // AT15 — precarga los thumbnails firmados de las imágenes del hilo.
      void this.resolveThumbs(this.mensajes());
      // AW15 — precarga las URLs firmadas de las notas de voz del hilo.
      void this.resolveAudios(this.mensajes());
      // AV5 — recibos + presencia de esta conversación (✓✓ y "escribiendo…").
      void this.setupCanalesConv(conv.id);
      await this.mensajeria.marcarLeido(conv.id, this.miId);
      // Zero out the unread badge locally + globally, y avanza mi marca de lectura
      // local para que reabrir la misma conversación no reviva el divisor (AT14).
      const ahora = new Date().toISOString();
      this.conversaciones.update((list) =>
        list.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                noLeidos: 0,
                participantes: (c.participantes ?? []).map((p) =>
                  p.usuario_id === this.miId ? { ...p, last_read_at: ahora } : p,
                ),
              }
            : c,
        ),
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
        void this.resolveThumbs([m]); // AT15 — thumbnail del adjunto entrante si es imagen
        void this.resolveAudios([m]); // AW15 — URL de la nota de voz entrante

      }
      // AV5 — recibí el mensaje en el dispositivo (aunque no esté enfocado) → ✓✓.
      if (m.autor_id !== this.miId) {
        void this.mensajeria.marcarEntregada(m.conversacion_id).catch(() => {});
      }
      // QA-058 — solo marcar como leído si la pestaña está enfocada; si el usuario
      // no está mirando, el mensaje sigue contando como no leído.
      if (m.autor_id !== this.miId && document.visibilityState === 'visible') {
        await this.mensajeria.marcarLeido(m.conversacion_id, this.miId);
      }
      // AV5 — el otro pudo abrir/leer: refresca los ✓✓ de mis mensajes.
      void this.refreshRecibos();
    }
    await this.refreshConversaciones();
    this.notificaciones.refresh();
  }

  // ── AV5 — recibos + presencia por conversación ────────────
  private async setupCanalesConv(convId: string) {
    this.cerrarCanalesConv();
    void this.refreshRecibos();
    void this.mensajeria.marcarEntregada(convId).catch(() => {});
    this.recibosCh = this.mensajeria.subscribeRecibos(convId, () => void this.refreshRecibos());
    this.presenciaCh = this.mensajeria.presenciaChannel(convId, (p) => this.onPresencia(p));
  }

  private async refreshRecibos() {
    const id = this.selectedId();
    if (!id) return;
    try {
      this.recibos.set(await this.mensajeria.getRecibos(id));
    } catch {
      /* recibos best-effort; no rompen el hilo */
    }
  }

  /** Recibe una acción de presencia de otro participante y arma el texto vivo. */
  private onPresencia(p: { usuario_id: string; nombre: string; accion: PresenciaAccion; at: number }) {
    if (p.usuario_id === this.miId) return;
    const prev = this.presenciaTimers.get(p.usuario_id);
    if (prev) clearTimeout(prev);
    if (p.accion === 'nada') {
      this.presenciaNombres.delete(p.usuario_id);
    } else {
      this.presenciaNombres.set(p.usuario_id, p.accion);
      // Auto-expira a los ~5s sin refresco (el emisor reenvía mientras actúa).
      this.presenciaTimers.set(
        p.usuario_id,
        setTimeout(() => {
          this.presenciaNombres.delete(p.usuario_id);
          this.presenciaTimers.delete(p.usuario_id);
          this.pintarPresencia();
        }, 5000),
      );
    }
    this.pintarPresencia();
  }

  private pintarPresencia() {
    const dir = this.nombrePorId;
    const partes: string[] = [];
    for (const [uid, accion] of this.presenciaNombres) {
      const nombre = dir.get(uid) ?? 'Alguien';
      const verbo = accion === 'grabando' ? 'grabando audio' : accion === 'sticker' ? 'eligiendo un sticker' : 'escribiendo';
      partes.push(`${nombre} está ${verbo}…`);
    }
    this.presenciaTexto.set(partes.slice(0, 2).join('  ·  '));
  }

  /** Difunde mi acción de presencia (throttle para no saturar el canal). */
  private emitirPresencia(accion: PresenciaAccion) {
    const ch = this.presenciaCh;
    if (!ch) return;
    const ahora = Date.now();
    if (accion !== 'nada' && ahora - this.typingUltimo < 2500) return;
    this.typingUltimo = accion === 'nada' ? 0 : ahora;
    void this.mensajeria.enviarPresencia(ch, { usuario_id: this.miId, nombre: this.miNombre, accion }).catch(() => {});
  }

  /** AY16 — reconcilia el hilo abierto con el server (merge por id, sin duplicar). */
  private async reconciliarHilo() {
    const id = this.selectedId();
    if (!id) return;
    try {
      const frescos = await this.mensajeria.getMensajes(id);
      const actualesIds = new Set(this.mensajes().map((m) => m.id));
      const nuevos = frescos.filter((m) => !actualesIds.has(m.id));
      if (nuevos.length > 0) {
        // Reemplaza por el set del server (autoritativo) preservando el orden.
        this.mensajes.set(frescos);
        void this.resolveThumbs(nuevos);
        void this.resolveAudios(nuevos);
      }
      void this.mensajeria.marcarEntregada(id).catch(() => {});
      void this.refreshRecibos();
    } catch {
      /* reconciliación best-effort */
    }
  }

  /** Carga (o limpia) la URL firmada del avatar de un grupo para la cabecera. */
  private async loadSelectedAvatar(conv: Conversacion) {
    if (conv.tipo !== 'grupo' || !conv.avatar_path) {
      this.selectedAvatarUrl.set(null);
      return;
    }
    this.selectedAvatarUrl.set(await this.mensajeria.getAvatarUrl(conv.avatar_path));
  }

  // ── Group info drawer ────────────────────────────────────
  openGrupoInfo() {
    const conv = this.selectedConv();
    if (conv?.tipo === 'grupo') this.grupoInfoOpen.set(true);
  }

  closeGrupoInfo() {
    this.grupoInfoOpen.set(false);
  }

  /** El grupo cambió (nombre/avatar/participantes): refresca lista, hilo y avatar. */
  async onGrupoChanged() {
    const id = this.selectedId();
    await this.refreshConversaciones();
    if (id) {
      try {
        this.mensajes.set(await this.mensajeria.getMensajes(id));
      } catch {
        /* no romper la vista si el hilo falla al recargar */
      }
      const conv = this.conversaciones().find((c) => c.id === id);
      if (conv) void this.loadSelectedAvatar(conv);
    }
    this.notificaciones.refresh();
  }

  /** El usuario salió del grupo: cierra el hilo y refresca la lista. */
  async onGrupoSalio() {
    this.grupoInfoOpen.set(false);
    this.selectedId.set(null);
    this.mensajes.set([]);
    this.selectedAvatarUrl.set(null);
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
        void this.resolveThumbs([m]); // AT15 — thumbnail del adjunto recién enviado si es imagen
      }
      this.composer.reset('');
      this.pendingFile.set(null);
      if (this.typingStopTimer) { clearTimeout(this.typingStopTimer); this.typingStopTimer = null; }
      this.emitirPresencia('nada'); // AV5 — dejé de escribir
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
      return;
    }
    // AV5 — "escribiendo…": difunde mientras teclea; auto-para a los 3s de inactividad.
    this.emitirPresencia('escribiendo');
    if (this.typingStopTimer) clearTimeout(this.typingStopTimer);
    this.typingStopTimer = setTimeout(() => this.emitirPresencia('nada'), 3000);
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

  /** AT14 — etiqueta del separador de día: "Hoy" / "Ayer" / fecha corta. */
  fechaSeparador(ts: string): string {
    const dia = timestampLocalIso(ts);
    if (dia && dia === todayIso()) return 'Hoy';
    if (dia && dia === daysAgoIso(1)) return 'Ayer';
    return formatFechaMedia(ts);
  }

  // ── AT15 — imágenes adjuntas inline ──────────────────────
  /** true si el adjunto del mensaje es una imagen (se muestra inline). */
  esImagen(m: Mensaje): boolean {
    return !!m.archivo_path && !!m.archivo_mime?.startsWith('image/');
  }

  /** Resuelve (y cachea) los thumbnails firmados de los mensajes-imagen dados. */
  private async resolveThumbs(msgs: Mensaje[]): Promise<void> {
    for (const m of msgs) {
      if (!this.esImagen(m) || this.thumbUrls().has(m.id)) continue;
      try {
        const url = await this.mensajeria.getThumbUrl(m.archivo_path!);
        if (url) this.thumbUrls.update((map) => new Map(map).set(m.id, url));
      } catch {
        /* el placeholder de app-img cubre el fallo */
      }
    }
  }

  /** Abre la imagen a tamaño completo en el lightbox (dentro de la página). */
  async verImagen(m: Mensaje): Promise<void> {
    if (!m.archivo_path) return;
    try {
      const url = await this.mensajeria.getArchivoUrl(m.archivo_path);
      this.lightbox.set(url);
    } catch (e: unknown) {
      this.toast.error('No se pudo abrir la imagen', e instanceof Error ? e.message : undefined);
    }
  }

  // ── AW15 — notas de voz ───────────────────────────────────
  /** true si el mensaje es una nota de voz (tipo 'audio'). */
  esAudio(m: Mensaje): boolean {
    return m.tipo === 'audio' || (!!m.archivo_mime?.startsWith('audio/') && !m.contenido);
  }

  /** Resuelve (y cachea) las URLs firmadas de los mensajes-audio para reproducir. */
  private async resolveAudios(msgs: Mensaje[]): Promise<void> {
    for (const m of msgs) {
      if (!this.esAudio(m) || !m.archivo_path || this.audioUrls().has(m.id)) continue;
      try {
        const url = await this.mensajeria.getArchivoUrl(m.archivo_path);
        if (url) this.audioUrls.update((map) => new Map(map).set(m.id, url));
      } catch {
        /* si falla la firma, el reproductor queda vacío */
      }
    }
  }

  audioUrlOf(m: Mensaje): string | null {
    return this.audioUrls().get(m.id) ?? null;
  }

  /** mm:ss para el timer de grabación y la duración de una nota de voz. */
  formatDur(seg: number | null | undefined): string {
    const s = Math.max(0, Math.round(seg ?? 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Empieza a grabar del micrófono (estilo WhatsApp: timer + nivel reactivo). */
  async iniciarGrabacion() {
    if (this.grabando() || this.sending()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.toast.error('Grabación no disponible', 'Tu navegador no permite grabar audio; adjunta un archivo.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.grabStream = stream;
      this.grabChunks = [];
      this.cancelarEnvio = false;
      const mr = new MediaRecorder(stream);
      this.mediaRecorder = mr;
      this.grabInicio = performance.now();
      mr.ondataavailable = (e) => { if (e.data.size > 0) this.grabChunks.push(e.data); };
      mr.onstop = () => void this.onGrabacionStop(mr);
      mr.start();
      this.grabando.set(true);
      this.emitirPresencia('grabando'); // AV5 — "grabando audio…"
      this.grabSegundos.set(0);
      this.grabTimer = setInterval(() => {
        this.grabSegundos.set(Math.floor((performance.now() - this.grabInicio) / 1000));
        // Corte de seguridad a 5 min.
        if (this.grabSegundos() >= 300) void this.detenerYEnviar();
      }, 250);
      this.iniciarMedidor(stream);
    } catch {
      this.limpiarGrabacion();
      this.toast.error('No se pudo acceder al micrófono', 'Revisa los permisos del navegador.');
    }
  }

  /** Detiene la grabación y envía la nota de voz. */
  async detenerYEnviar() {
    if (!this.grabando()) return;
    this.cancelarEnvio = false;
    this.mediaRecorder?.stop();
  }

  /** Cancela la grabación (descarta el audio, no envía). */
  cancelarGrabacion() {
    if (!this.grabando()) return;
    this.cancelarEnvio = true;
    this.mediaRecorder?.stop();
  }

  private async onGrabacionStop(mr: MediaRecorder) {
    const dur = Math.round((performance.now() - this.grabInicio) / 1000);
    const blob = new Blob(this.grabChunks, { type: mr.mimeType || 'audio/webm' });
    this.limpiarGrabacion();
    if (this.cancelarEnvio || blob.size === 0 || dur < 1) return;

    const conv = this.selectedConv();
    if (!conv) return;
    this.sending.set(true);
    try {
      const clientId = crypto.randomUUID();
      const m = await this.mensajeria.enviarNotaVoz(conv.id, blob, dur, clientId);
      if (!this.mensajes().some((x) => x.id === m.id)) {
        this.nextScrollBehavior = 'smooth';
        this.mensajes.update((list) => [...list, m]);
        void this.resolveAudios([m]);
      }
      await this.refreshConversaciones();
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar la nota de voz', e instanceof Error ? e.message : undefined);
    } finally {
      this.sending.set(false);
    }
  }

  private iniciarMedidor(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.audioCtx = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      this.analyser = an;
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        this.nivel.set(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        this.nivelRaf = requestAnimationFrame(tick);
      };
      this.nivelRaf = requestAnimationFrame(tick);
    } catch {
      /* medidor best-effort; la grabación sigue sin él */
    }
  }

  private limpiarGrabacion() {
    if (this.grabando()) this.emitirPresencia('nada'); // AV5 — dejé de grabar
    this.grabando.set(false);
    this.nivel.set(0);
    if (this.grabTimer) { clearInterval(this.grabTimer); this.grabTimer = null; }
    if (this.nivelRaf) { cancelAnimationFrame(this.nivelRaf); this.nivelRaf = 0; }
    this.analyser = null;
    if (this.audioCtx) { void this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
    this.grabStream?.getTracks().forEach((t) => t.stop());
    this.grabStream = null;
    this.mediaRecorder = null;
    this.grabChunks = [];
  }

  // ── AT16 — stickers ──────────────────────────────────────
  /** URL de una ref de sticker (delegada al servicio). */
  stickerUrl(ref: string): string {
    return this.mensajeria.stickerUrl(ref);
  }

  /** Abre/cierra el selector de stickers; carga packs y recientes en la 1ª apertura. */
  toggleStickerPicker() {
    const abrir = !this.stickerPickerOpen();
    this.stickerPickerOpen.set(abrir);
    if (abrir && !this.stickersCargados) void this.loadStickers();
  }

  private async loadStickers() {
    this.stickerLoading.set(true);
    try {
      const [packs, recientes] = await Promise.all([
        this.mensajeria.getMisStickers(),
        this.mensajeria.getStickersRecientes(),
      ]);
      this.stickerPacks.set(packs);
      this.stickerRecientes.set(recientes);
      this.stickersCargados = true;
    } catch (e: unknown) {
      this.toast.error('No se pudieron cargar los stickers', e instanceof Error ? e.message : undefined);
    } finally {
      this.stickerLoading.set(false);
    }
  }

  /** Envía un sticker al hilo abierto (realtime lo entrega); refresca recientes local. */
  async enviarStickerMsg(ref: string) {
    const conv = this.selectedConv();
    if (!conv) return;
    try {
      await this.mensajeria.enviarSticker(conv.id, this.miId, ref);
      // Sube el ref al frente de recientes (sin duplicar) para reflejarlo al instante.
      this.stickerRecientes.update((list) => [ref, ...list.filter((r) => r !== ref)]);
      this.stickerPickerOpen.set(false);
      await this.refreshConversaciones();
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar el sticker', e instanceof Error ? e.message : undefined);
    }
  }

  /** Sube una imagen como sticker propio y recarga los packs. */
  async onStickerFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.stickerUploading()) return;
    this.stickerUploading.set(true);
    try {
      // Si el pack activo es propio, súbelo ahí; si no, al pack automático.
      const activo = this.stickerPackActivo();
      const packId = activo && !activo.es_sistema ? activo.id : undefined;
      await this.mensajeria.subirSticker(this.miId, file, packId);
      this.stickerPacks.set(await this.mensajeria.getMisStickers());
      this.toast.success('Sticker agregado');
    } catch (e: unknown) {
      this.toast.error('No se pudo subir el sticker', e instanceof Error ? e.message : undefined);
    } finally {
      this.stickerUploading.set(false);
      input.value = ''; // permite re-subir el mismo archivo
    }
  }

  /** Elimina un sticker propio y recarga los packs. */
  async eliminarStickerLocal(stickerId: string) {
    try {
      await this.mensajeria.eliminarSticker(stickerId);
      this.stickerPacks.set(await this.mensajeria.getMisStickers());
    } catch (e: unknown) {
      this.toast.error('No se pudo eliminar el sticker', e instanceof Error ? e.message : undefined);
    }
  }

  /** AV4 — guarda un sticker recibido de otro a "Mis stickers". */
  async guardarStickerRecibido(ref: string) {
    try {
      await this.mensajeria.guardarSticker(ref);
      this.stickersCargados = false; // fuerza recarga la próxima vez que abra el picker
      this.toast.success('Sticker guardado');
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar el sticker', e instanceof Error ? e.message : undefined);
    }
  }

  // ── AV5 — estado de mis mensajes (✓ enviado / ✓✓ entregado / ✓✓ azul leído) ──
  estadoMensaje(m: Mensaje): EstadoMensaje | null {
    if (m.autor_id !== this.miId || m.tipo === 'sistema') return null;
    const recibos = this.recibos();
    if (recibos.length === 0) return 'enviado';
    const t = m.created_at;
    if (recibos.every((r) => r.last_read_at != null && r.last_read_at >= t)) return 'leido';
    if (recibos.every((r) => r.last_delivered_at != null && r.last_delivered_at >= t)) return 'entregado';
    return 'enviado';
  }

  // ── AY14 — cards de documento (Word/Excel/PPT/PDF) + visor inline ──────────
  /** true si el adjunto NO es imagen/audio/sticker → se pinta como card de doc. */
  esDocumento(m: Mensaje): boolean {
    return !!m.archivo_path && m.tipo !== 'sticker' && !this.esImagen(m) && !this.esAudio(m);
  }

  esPdf(m: Mensaje): boolean {
    return !!m.archivo_mime?.includes('pdf') || !!m.archivo_nombre?.toLowerCase().endsWith('.pdf');
  }

  /** Clave de tipo para elegir el ícono/color de la card. */
  docTipo(m: Mensaje): 'pdf' | 'word' | 'excel' | 'ppt' | 'zip' | 'file' {
    const n = (m.archivo_nombre ?? '').toLowerCase();
    const mime = (m.archivo_mime ?? '').toLowerCase();
    if (mime.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
    if (mime.includes('word') || /\.(docx?|rtf|odt)$/.test(n)) return 'word';
    if (mime.includes('sheet') || mime.includes('excel') || /\.(xlsx?|csv|ods)$/.test(n)) return 'excel';
    if (mime.includes('presentation') || mime.includes('powerpoint') || /\.(pptx?|odp)$/.test(n)) return 'ppt';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return 'zip';
    return 'file';
  }

  /** Tamaño legible del adjunto ('' si desconocido). */
  formatSize(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }

  /** Abre un PDF en el visor inline; otros documentos se descargan/abren. */
  async abrirDocumento(m: Mensaje) {
    if (!m.archivo_path) return;
    if (this.esPdf(m)) {
      try {
        const url = await this.mensajeria.getArchivoUrl(m.archivo_path);
        this.pdfViewer.set({
          url,
          safe: this.sanitizer.bypassSecurityTrustResourceUrl(url),
          nombre: m.archivo_nombre ?? 'Documento.pdf',
        });
      } catch (e: unknown) {
        this.toast.error('No se pudo abrir el PDF', e instanceof Error ? e.message : undefined);
      }
      return;
    }
    void this.descargarArchivo(m);
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

  // ── AX3 — links clickeables en los mensajes de texto (paridad con la app) ────
  /** Parte el texto en tramos: texto plano + URLs http/https clickeables. Solo
   *  reconoce esquemas seguros (http/https) → no ejecuta ni abre nada raro. */
  segmentos(texto: string | null): Array<{ link: boolean; v: string }> {
    if (!texto) return [];
    const re = /(https?:\/\/[^\s<>"']+)/gi;
    const out: Array<{ link: boolean; v: string }> = [];
    let last = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(texto)) !== null) {
      if (mm.index > last) out.push({ link: false, v: texto.slice(last, mm.index) });
      let url = mm[0];
      const trailing = url.match(/[)\].,;:!?»"']+$/);
      if (trailing) url = url.slice(0, url.length - trailing[0].length);
      out.push({ link: true, v: url });
      last = mm.index + url.length;
    }
    if (last < texto.length) out.push({ link: false, v: texto.slice(last) });
    return out;
  }

  /** Abre un link en una pestaña nueva con noopener (solo http/https válidos). */
  abrirLink(url: string): void {
    if (!/^https?:\/\//i.test(url)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  iniciales(nombre: string): string {
    return nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
}
