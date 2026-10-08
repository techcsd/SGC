import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** CI2 — Documento legal público (markdown). Front-matter mínimo. */
interface DocMeta {
  titulo: string;
  version?: string;
  vigencia?: string;
  estado?: 'borrador' | 'vigente';
}

/** Documentos válidos → archivo en assets/politicas/. */
const DOCS: Record<string, { file: string; desc: string }> = {
  privacidad: {
    file: 'privacidad',
    desc: 'Política de Privacidad de la CSD App y el sistema SGC de Constructora SD.',
  },
  terminos: {
    file: 'terminos',
    desc: 'Términos de uso de la CSD App y el sistema SGC de Constructora SD.',
  },
  soporte: {
    file: 'soporte',
    desc: 'Soporte y contacto de la CSD App y el sistema SGC de Constructora SD.',
  },
};

/**
 * CI2 — Páginas públicas (sin login) de privacidad/términos/soporte.
 * Renderiza el Markdown versionado de `assets/politicas/<doc>.md`.
 * Patrón: página top-level fuera del Shell (como `verificar/:carnet`).
 */
@Component({
  selector: 'app-politicas',
  imports: [],
  templateUrl: './politicas.html',
  styleUrl: './politicas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Politicas implements OnInit {
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  private metaTag = inject(Meta);

  loading = signal(true);
  notFound = signal(false);
  meta = signal<DocMeta | null>(null);
  html = signal<string>('');

  async ngOnInit() {
    const doc = this.route.snapshot.paramMap.get('doc') ?? '';
    const entry = DOCS[doc];
    if (!entry) {
      this.notFound.set(true);
      this.loading.set(false);
      this.title.setTitle('Documento no encontrado · Constructora SD');
      return;
    }
    try {
      const res = await fetch(`assets/politicas/${entry.file}.md`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const raw = await res.text();
      const { meta, body } = this.parseFrontMatter(raw);
      this.meta.set(meta);
      const parsed = marked.parse(body, { async: false }) as string;
      this.html.set(DOMPurify.sanitize(parsed, { ADD_ATTR: ['target', 'rel'] }));
      // Las tiendas comprueban que la URL responde con <title> + meta description.
      this.title.setTitle(`${meta.titulo} · Constructora SD`);
      this.metaTag.updateTag({ name: 'description', content: entry.desc });
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Parser mínimo de front-matter `---\nclave: valor\n---`. Sin dependencias. */
  private parseFrontMatter(raw: string): { meta: DocMeta; body: string } {
    const meta: DocMeta = { titulo: 'Documento' };
    const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!m) return { meta, body: raw };
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'titulo') meta.titulo = val;
      else if (key === 'version') meta.version = val;
      else if (key === 'vigencia') meta.vigencia = val;
      else if (key === 'estado') meta.estado = val === 'vigente' ? 'vigente' : 'borrador';
    }
    return { meta, body: raw.slice(m[0].length) };
  }

  imprimir() {
    window.print();
  }
}
