import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsistenteService, AsistenteMensaje, AsistenteConversacion, AsistentePropuesta } from '../../../shared/services/asistente.service';

/**
 * AW4 — "Compa", el asistente conversacional de SGC (v1 solo-lectura). La UI es
 * un chat; toda la lógica vive en la edge function `assistant`. Compa hereda los
 * permisos del usuario, así que solo ve lo que el usuario puede ver.
 */
@Component({
  selector: 'app-asistente',
  imports: [FormsModule],
  templateUrl: './asistente.html',
  styleUrl: './asistente.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asistente implements OnInit {
  private service = inject(AsistenteService);

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
  // AY11/C2 — archivo (PDF) generado, listo para descargar.
  archivo = signal<{ nombre: string; url: string } | null>(null);

  vacio = computed(() => this.mensajes().length === 0);

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
    // BA3 — carga los chips/saludo del rol; no bloquea el resto si falla.
    void this.service.sugerenciasPorRol().then((s) => {
      if (s.chips.length) this.sugerencias.set(s.chips);
      if (s.saludo) this.saludo.set(s.saludo);
      if (s.subtitulo) this.subtitulo.set(s.subtitulo);
    });
    this.conversaciones.set(await this.service.conversacionesRecientes());
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
    this.archivo.set(null);
    this.conversacionId.set(c.id);
    this.service.setOpen(c.id);
    this.mensajes.set(await this.service.mensajes(c.id));
    this.input.set(this.service.getDraft(c.id));
    this.scrollAlFinal();
    this.enfocarInput();
  }

  nueva() {
    this.conversacionId.set(null);
    this.service.setOpen(null);
    this.mensajes.set([]);
    this.error.set('');
    this.propuesta.set(null);
    this.archivo.set(null);
    this.input.set(this.service.getDraft(null));
    this.enfocarInput();
  }

  usarSugerencia(s: string) {
    this.input.set(s);
    void this.enviar();
  }

  async enviar() {
    const texto = this.input().trim();
    if (!texto || this.enviando()) return;
    const convKeyAntes = this.conversacionId();
    this.error.set('');
    this.propuesta.set(null);
    this.archivo.set(null);
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
      this.archivo.set(res.archivo ?? null);
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
  separadorDia(i: number): string | null {
    const ms = this.mensajes();
    const actual = ms[i]?.created_at;
    if (!actual) return null;
    const label = this.fecha(actual);
    if (i === 0) return label;
    const prev = ms[i - 1]?.created_at;
    return prev && this.fecha(prev) === label ? null : label;
  }
}
