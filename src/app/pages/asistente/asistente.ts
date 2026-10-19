import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AsistenteService, AsistenteMensaje, AsistenteConversacion, AsistentePropuesta, CompaCompartida } from '../../../shared/services/asistente.service';
import { ConsentimientoIA } from '../../../shared/ui/consentimiento-ia/consentimiento-ia';
import { PrivacidadService } from '../../../shared/services/privacidad.service';
import { UserPicker, UserPickerSelection } from '../../../shared/ui/user-picker/user-picker';
import { ToastService } from '../../../shared/services/toast.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

/**
 * AW4 — "Compa", el asistente conversacional de SGC (v1 solo-lectura). La UI es
 * un chat; toda la lógica vive en la edge function `assistant`. Compa hereda los
 * permisos del usuario, así que solo ve lo que el usuario puede ver.
 * CP2 — además de sus conversaciones, un usuario puede COMPARTIR una (solo
 * lectura con los permisos de quien la ve) y ver las que le compartieron.
 */
@Component({
  selector: 'app-asistente',
  imports: [FormsModule, ConsentimientoIA, UserPicker, TranslatePipe, RouterLink],
  templateUrl: './asistente.html',
  styleUrl: './asistente.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asistente implements OnInit {
  private service = inject(AsistenteService);
  private privacidad = inject(PrivacidadService);
  private toast = inject(ToastService);

  // CI10 — consentimiento de IA: null = aún sin saber, false = debe decidir.
  consentIA = signal<boolean | null>(null);
  mostrarConsentimiento = signal(false);

  private scrollAnchor = viewChild<ElementRef<HTMLDivElement>>('anchor');
  private composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  mensajes = signal<AsistenteMensaje[]>([]);
  conversaciones = signal<AsistenteConversacion[]>([]);
  conversacionId = signal<string | null>(null);
  input = signal('');
  enviando = signal(false);
  error = signal('');
  // AW4 v2 — acción preparada, a la espera de confirmación del usuario.
  propuesta = signal<AsistentePropuesta | null>(null);
  ejecutando = signal(false);
  // CP3/CP9 — uno o varios archivos (PDF/Excel) generados, listos para descargar.
  archivos = signal<{ nombre: string; url: string }[]>([]);

  // ── CP2 — compartir + compartidas conmigo ─────────────────────────────────
  compartidas = signal<CompaCompartida[]>([]);
  viendoCompartida = signal<CompaCompartida | null>(null);
  mensajesCompartida = signal<AsistenteMensaje[]>([]);
  cargandoCompartida = signal(false);
  mostrarCompartir = signal(false);
  compartirDestino = signal<UserPickerSelection | null>(null);
  compartirMensaje = signal('');
  compartiendo = signal(false);

  vacio = computed(() => this.mensajes().length === 0 && !this.viendoCompartida());

  // BA3 — chips y saludo por rol (fuente única en BD). Fallback si el RPC no responde.
  sugerencias = signal<string[]>([
    '¿Qué tareas tengo pendientes?',
    '¿Tengo conduces por firmar?',
    '¿En qué obras estoy?',
    '¿A qué tengo acceso en el sistema?',
  ]);
  saludo = signal('¡Hola! Soy Compa 👋');
  subtitulo = signal('Tu asistente de SGC — responde con datos reales, según lo que tú puedes ver.');

  async ngOnInit() {
    // CI10 — consentimiento de IA: si no lo otorgó, muestra la hoja antes del primer uso.
    void this.privacidad.miConsentimiento('ia').then((ok) => {
      this.consentIA.set(ok);
      if (!ok) this.mostrarConsentimiento.set(true);
    }).catch(() => this.consentIA.set(null));
    // BA3 — carga los chips/saludo del rol; no bloquea el resto si falla.
    void this.service.sugerenciasPorRol().then((s) => {
      if (s.chips.length) this.sugerencias.set(s.chips);
      if (s.saludo) this.saludo.set(s.saludo);
      if (s.subtitulo) this.subtitulo.set(s.subtitulo);
    });
    this.conversaciones.set(await this.service.conversacionesRecientes());
    // CP2 — no bloquea el resto si falla.
    void this.service.compartidasConmigo().then((c) => this.compartidas.set(c));
    // AY10 — retomar donde quedó: si había una conversación abierta, se recarga
    // (sus mensajes vienen del servidor, así que una respuesta que terminó
    // mientras el usuario navegaba aparece completa). Si no, panel nuevo.
    const abiertaId = this.service.openConversacionId();
    const abierta = abiertaId ? this.conversaciones().find((c) => c.id === abiertaId) : null;
    if (abierta) {
      await this.abrir(abierta);
    } else {
      this.service.setOpen(null);
      this.input.set(this.service.getDraft(null));
    }
    // BB2 — autofocus al entrar al módulo (solo en dispositivos con puntero).
    this.enfocarInput();
  }

  /** BB2 — enfoca el input, pero NO en móvil (abrir el teclado de golpe molesta).
   *  Solo en dispositivos con puntero fino (desktop/web). */
  private enfocarInput() {
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) return;
    setTimeout(() => this.composer()?.nativeElement.focus(), 30);
  }

  /** BB2 — Enter envía; Shift+Enter inserta salto de línea. */
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.enviar();
    }
  }

  /** AY10 — el input se persiste por conversación al escribir. */
  onInput(v: string) {
    this.input.set(v);
    this.service.setDraft(this.conversacionId(), v);
  }

  async abrir(c: AsistenteConversacion) {
    this.error.set('');
    this.propuesta.set(null);
    this.archivos.set([]);
    this.viendoCompartida.set(null);
    this.conversacionId.set(c.id);
    this.service.setOpen(c.id);
    this.mensajes.set(await this.service.mensajes(c.id));
    this.input.set(this.service.getDraft(c.id));
    this.scrollAlFinal();
    this.enfocarInput();
  }

  nueva() {
    this.conversacionId.set(null);
    this.viendoCompartida.set(null);
    this.service.setOpen(null);
    this.mensajes.set([]);
    this.error.set('');
    this.propuesta.set(null);
    this.archivos.set([]);
    this.input.set(this.service.getDraft(null));
    this.enfocarInput();
  }

  usarSugerencia(s: string) {
    this.input.set(s);
    void this.enviar();
  }

  /** CI10 — decisión de la hoja de consentimiento de IA. */
  onConsentDecidido(ok: boolean) {
    this.consentIA.set(ok);
    this.mostrarConsentimiento.set(false);
  }

  async enviar() {
    const texto = this.input().trim();
    if (!texto || this.enviando()) return;
    // CI10 — sin consentimiento de IA no se envía; se ofrece la hoja.
    if (this.consentIA() === false) {
      this.mostrarConsentimiento.set(true);
      return;
    }
    const convKeyAntes = this.conversacionId();
    this.error.set('');
    this.propuesta.set(null);
    this.archivos.set([]);
    this.input.set('');
    this.service.setDraft(convKeyAntes, '');
    const ahora = new Date().toISOString();
    this.mensajes.update((m) => [...m, { rol: 'user', contenido: texto, created_at: ahora }]);
    this.enviando.set(true);
    this.scrollAlFinal();
    try {
      const res = await this.service.enviar(texto, this.conversacionId());
      this.conversacionId.set(res.conversacion_id);
      this.service.setOpen(res.conversacion_id);
      this.mensajes.update((m) => [...m, { rol: 'assistant', contenido: res.respuesta, herramientas: res.herramientas, created_at: new Date().toISOString() }]);
      this.propuesta.set(res.propuesta ?? null);
      this.archivos.set(res.archivos ?? (res.archivo ? [res.archivo] : []));
      this.conversaciones.set(await this.service.conversacionesRecientes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo contactar al asistente.');
    } finally {
      this.enviando.set(false);
      this.scrollAlFinal();
      // BB2 — re-enfocar tras enviar para seguir escribiendo sin volver a hacer click.
      this.enfocarInput();
    }
  }

  /** AW4 v2 — confirma y ejecuta la acción preparada (mismo RPC del flujo normal). */
  async confirmarPropuesta() {
    const prop = this.propuesta();
    if (!prop || this.ejecutando()) return;
    this.ejecutando.set(true);
    this.error.set('');
    try {
      const res = await this.service.ejecutar(prop, this.conversacionId());
      this.mensajes.update((m) => [...m, { rol: 'assistant', contenido: res.respuesta }]);
      this.propuesta.set(null);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo ejecutar la acción.');
    } finally {
      this.ejecutando.set(false);
      this.scrollAlFinal();
    }
  }

  cancelarPropuesta() {
    this.propuesta.set(null);
    this.mensajes.update((m) => [...m, { rol: 'assistant', contenido: 'Ok, cancelé esa acción. ¿Algo más?' }]);
  }

  private scrollAlFinal() {
    setTimeout(() => this.scrollAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth' }), 60);
  }

  // ── CP2 — compartir esta conversación ─────────────────────────────────────
  abrirCompartir() {
    this.compartirDestino.set(null);
    this.compartirMensaje.set('');
    this.mostrarCompartir.set(true);
  }
  cerrarCompartir() {
    this.mostrarCompartir.set(false);
  }
  onPersonaCompartir(sel: UserPickerSelection) {
    this.compartirDestino.set(sel);
  }
  async confirmarCompartir() {
    const convId = this.conversacionId();
    const destino = this.compartirDestino();
    if (!convId || !destino?.usuario_id || this.compartiendo()) return;
    this.compartiendo.set(true);
    try {
      await this.service.compartir(convId, [destino.usuario_id], this.compartirMensaje().trim() || null);
      this.toast.success('Conversación compartida', `${destino.nombre} ya puede verla en "Compartidas conmigo".`);
      this.mostrarCompartir.set(false);
    } catch (e: unknown) {
      this.toast.error('No se pudo compartir', e instanceof Error ? e.message : undefined);
    } finally {
      this.compartiendo.set(false);
    }
  }

  // ── CP2 — ver una conversación que me compartieron (solo lectura) ─────────
  async abrirCompartida(c: CompaCompartida) {
    this.error.set('');
    this.propuesta.set(null);
    this.archivos.set([]);
    this.conversacionId.set(null);
    this.service.setOpen(null);
    this.viendoCompartida.set(c);
    this.cargandoCompartida.set(true);
    try {
      this.mensajesCompartida.set(await this.service.conversacionCompartida(c.id));
      // ya no es "Nueva" tras verla — refleja localmente sin re-pedir la lista.
      this.compartidas.update((list) => list.map((x) => (x.id === c.id ? { ...x, vista_at: x.vista_at ?? new Date().toISOString() } : x)));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo abrir esta conversación.');
    } finally {
      this.cargandoCompartida.set(false);
      this.scrollAlFinal();
    }
  }

  /** CP2 — "Seguir en una conversación mía": abre un chat propio con el contexto como primer mensaje. */
  seguirCompartida() {
    const c = this.viendoCompartida();
    if (!c) return;
    const primerMensaje = this.mensajesCompartida().find((m) => m.rol === 'user')?.contenido ?? '';
    this.viendoCompartida.set(null);
    this.nueva();
    const contexto = `Continuando desde una conversación que ${c.compartida_por_nombre} compartió conmigo: "${primerMensaje.slice(0, 140)}"`;
    this.input.set(contexto);
    this.enfocarInput();
  }

  // ── AY11a — fecha/hora en los mensajes y en la lista ──────────────────────
  private static readonly HORA = new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit' });
  private static readonly FECHA = new Intl.DateTimeFormat('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

  /** Hora corta (HH:mm) de un mensaje; vacío si no hay timestamp. */
  hora(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : Asistente.HORA.format(d);
  }

  /** Etiqueta de fecha ("Hoy" / "Ayer" / dd mmm yyyy) para separadores y lista. */
  fecha(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hoy = new Date();
    const dd = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dias = Math.round((dd(hoy) - dd(d)) / 86_400_000);
    if (dias === 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    return Asistente.FECHA.format(d);
  }

  /** Separador de día: devuelve la etiqueta si el mensaje i abre un día nuevo. */
  separadorDia(mensajes: AsistenteMensaje[], i: number): string | null {
    const actual = mensajes[i]?.created_at;
    if (!actual) return null;
    const label = this.fecha(actual);
    if (i === 0) return label;
    const prev = mensajes[i - 1]?.created_at;
    return prev && this.fecha(prev) === label ? null : label;
  }
}
