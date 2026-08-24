import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsistenteService, AsistenteMensaje, AsistenteConversacion } from '../../../shared/services/asistente.service';

/**
 * AW4 — "Tato", el asistente conversacional de SGC (v1 solo-lectura). La UI es
 * un chat; toda la lógica vive en la edge function `assistant`. Tato hereda los
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

  mensajes = signal<AsistenteMensaje[]>([]);
  conversaciones = signal<AsistenteConversacion[]>([]);
  conversacionId = signal<string | null>(null);
  input = signal('');
  enviando = signal(false);
  error = signal('');

  vacio = computed(() => this.mensajes().length === 0);

  readonly sugerencias = [
    '¿Qué tareas tengo pendientes?',
    '¿Tengo conduces por firmar?',
    '¿En qué obras estoy?',
    'Busca el artículo "cemento"',
  ];

  async ngOnInit() {
    this.conversaciones.set(await this.service.conversacionesRecientes());
  }

  async abrir(c: AsistenteConversacion) {
    this.error.set('');
    this.conversacionId.set(c.id);
    this.mensajes.set(await this.service.mensajes(c.id));
    this.scrollAlFinal();
  }

  nueva() {
    this.conversacionId.set(null);
    this.mensajes.set([]);
    this.error.set('');
    this.input.set('');
  }

  usarSugerencia(s: string) {
    this.input.set(s);
    void this.enviar();
  }

  async enviar() {
    const texto = this.input().trim();
    if (!texto || this.enviando()) return;
    this.error.set('');
    this.input.set('');
    this.mensajes.update((m) => [...m, { rol: 'user', contenido: texto }]);
    this.enviando.set(true);
    this.scrollAlFinal();
    try {
      const res = await this.service.enviar(texto, this.conversacionId());
      this.conversacionId.set(res.conversacion_id);
      this.mensajes.update((m) => [...m, { rol: 'assistant', contenido: res.respuesta, herramientas: res.herramientas }]);
      // Refresca la lista de conversaciones (nombre/orden).
      this.conversaciones.set(await this.service.conversacionesRecientes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo contactar al asistente.');
    } finally {
      this.enviando.set(false);
      this.scrollAlFinal();
    }
  }

  private scrollAlFinal() {
    setTimeout(() => this.scrollAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth' }), 60);
  }
}
