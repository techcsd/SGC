import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title, Meta } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { SupabaseService } from '../../../core/services/supabase.service';

/**
 * CI4 — Página PÚBLICA (sin login) para solicitar la eliminación de cuenta, para
 * quien ya no tiene acceso a la app. Renderiza eliminar-cuenta.md + un formulario
 * que llama a la edge pública `solicitar-eliminacion` (respuesta siempre neutra).
 */
@Component({
  selector: 'app-eliminar-cuenta',
  imports: [FormsModule],
  templateUrl: './eliminar-cuenta.html',
  styleUrl: '../politicas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EliminarCuenta implements OnInit {
  private supabase = inject(SupabaseService);
  private title = inject(Title);
  private metaTag = inject(Meta);

  html = signal<string>('');
  identificador = signal('');
  motivo = signal('');
  website = signal(''); // honeypot (oculto)
  enviando = signal(false);
  enviado = signal(false);

  async ngOnInit() {
    this.title.setTitle('Eliminar cuenta · Constructora SD');
    this.metaTag.updateTag({
      name: 'description',
      content: 'Solicita la eliminación de tu cuenta de la CSD App de Constructora SD.',
    });
    try {
      const res = await fetch('assets/politicas/eliminar-cuenta.md', { cache: 'no-cache' });
      const raw = await res.text();
      const parsed = marked.parse(raw, { async: false }) as string;
      this.html.set(DOMPurify.sanitize(parsed, { ADD_ATTR: ['target', 'rel'] }));
    } catch {
      this.html.set('');
    }
  }

  async enviar() {
    if (this.enviando() || !this.identificador().trim()) return;
    this.enviando.set(true);
    try {
      await this.supabase.client.functions.invoke('solicitar-eliminacion', {
        body: {
          identificador: this.identificador().trim(),
          motivo: this.motivo().trim(),
          website: this.website(),
        },
      });
    } catch {
      // La respuesta es neutra; incluso ante un fallo mostramos el acuse.
    } finally {
      this.enviando.set(false);
      this.enviado.set(true);
    }
  }
}
