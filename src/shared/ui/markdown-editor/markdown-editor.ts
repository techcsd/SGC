import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  viewChild,
  ElementRef,
} from '@angular/core';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { Icon } from '../icon/icon';

// Config global de marked (una vez): GFM + saltos + resaltado con highlight.js.
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined;
      const body = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
      return `<pre class="md-code hljs"><code>${body}</code></pre>`;
    },
  },
});

const LENGUAJES = ['ts', 'sql', 'bash', 'json', 'html', 'scss', 'yaml', 'md'] as const;

/**
 * BP5 — Editor markdown reutilizable (Dev notes). textarea a la izquierda, preview
 * a la derecha (toggle en móvil). Sanitiza el HTML del preview (DOMPurify) porque el
 * contenido se comparte entre usuarios. Detrás de esta interfaz se puede cambiar a
 * CodeMirror sin tocar a los llamadores.
 */
@Component({
  selector: 'app-markdown-editor',
  imports: [Icon],
  templateUrl: './markdown-editor.html',
  styleUrl: './markdown-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditor {
  value = input<string>('');
  disabled = input<boolean>(false);
  valueChange = output<string>();

  readonly LENGUAJES = LENGUAJES;
  private area = viewChild<ElementRef<HTMLTextAreaElement>>('area');
  vistaPreview = signal(false); // móvil: alterna edición/preview

  preview = computed(() => {
    const md = this.value() ?? '';
    if (!md.trim()) return '';
    const html = marked.parse(md, { async: false }) as string;
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  });

  onInput(v: string) {
    this.valueChange.emit(v);
  }

  onKeydown(ev: KeyboardEvent) {
    if (this.disabled()) return;
    // Tab inserta 2 espacios en vez de saltar de campo.
    if (ev.key === 'Tab') {
      ev.preventDefault();
      this.wrap('  ', '');
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'b') { ev.preventDefault(); this.wrap('**', '**'); }
      else if (k === 'i') { ev.preventDefault(); this.wrap('*', '*'); }
      else if (k === 'k') { ev.preventDefault(); this.wrap('[', '](url)'); }
    }
  }

  bold() { this.wrap('**', '**'); }
  italic() { this.wrap('*', '*'); }
  link() { this.wrap('[', '](url)'); }
  heading() { this.wrap('## ', ''); }
  bullet() { this.wrap('- ', ''); }
  code(lang: string) { this.wrap('\n```' + lang + '\n', '\n```\n'); }

  /** Envuelve la selección actual con `before`/`after` y re-emite el valor. */
  private wrap(before: string, after: string) {
    const el = this.area()?.nativeElement;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const sel = el.value.slice(start, end);
    const next = el.value.slice(0, start) + before + sel + after + el.value.slice(end);
    el.value = next; // refleja de inmediato (el [value] del round-trip lo confirma)
    this.valueChange.emit(next);
    // Reposiciona el cursor tras el render.
    queueMicrotask(() => {
      el.focus();
      const pos = start + before.length + sel.length;
      el.setSelectionRange(pos, pos);
    });
  }
}
