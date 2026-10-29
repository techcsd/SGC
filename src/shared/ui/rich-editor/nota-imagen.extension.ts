import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * CS2/CT2 — imagen pegada/arrastrada en una nota. Reusa el nodo `image` estándar
 * (así el Markdown sigue siendo `![alt](src)`, sin tocar `tiptap-markdown`) pero
 * con un `NodeView` casero: el `src` que se guarda es `nota-img:<ruta>` (nunca
 * una URL firmada, que caduca) y este NodeView la resuelve a una URL mostrable
 * al vuelo. Miniatura acotada (CT2: antes ocupaba varias pantallas de alto),
 * barra de acciones siempre visible (antes solo al hover — Xaviel no la vio),
 * visor a pantalla completa, y «Quitar» con confirmación (antes borraba sin
 * avisar) que también funciona con `Supr`/`Backspace` sobre la imagen seleccionada.
 */
export interface NotaImagenOptions {
  resolverUrl: (src: string) => Promise<string>;
  copiarAlPortapapeles: (url: string) => Promise<void>;
  descargar: (url: string, nombre: string) => void;
  /** Se llama al pulsar «Quitar» (ya confirmado) — borra el archivo de Storage (best-effort). */
  onQuitar: (src: string) => void;
}

const CONFIRM_QUITAR = '¿Quitar esta imagen? También se borra el archivo.';

export const NotaImagen = Image.extend<NotaImagenOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      HTMLAttributes: {},
      resolverUrl: async (src: string) => src,
      copiarAlPortapapeles: async () => { throw new Error('No configurado.'); },
      descargar: () => {},
      onQuitar: () => {},
    };
  },

  // CT2 — Supr/Backspace con la imagen seleccionada (NodeSelection de este tipo)
  // piden la misma confirmación y limpieza que el botón «Quitar».
  addKeyboardShortcuts() {
    const quitarSiSeleccionada = (): boolean => {
      const { selection } = this.editor.state;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
      if (!confirm(CONFIRM_QUITAR)) return true; // evita que el navegador borre texto alrededor
      this.options.onQuitar((selection.node.attrs['src'] as string) ?? '');
      return this.editor.commands.deleteSelection();
    };
    return { Delete: quitarSiSeleccionada, Backspace: quitarSiSeleccionada };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'nota-img';
      wrapper.contentEditable = 'false';

      const img = document.createElement('img');
      img.alt = (node.attrs['alt'] as string) ?? '';
      img.className = 'nota-img__img';
      img.title = 'Ver a pantalla completa';
      wrapper.appendChild(img);

      const estado = document.createElement('div');
      estado.className = 'nota-img__estado';
      estado.textContent = 'Subiendo imagen…';
      wrapper.appendChild(estado);

      // DB2 — la barra va DEBAJO de la miniatura (la barra flotante de CT2 tapaba
      // media captura de teléfono) con iconos SVG (AW12) + nombre · tamaño.
      const barra = document.createElement('div');
      barra.className = 'nota-img__barra';
      const meta = document.createElement('span');
      meta.className = 'nota-img__meta';
      barra.appendChild(meta);
      const SVGS: Record<string, string> = {
        full: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
        copiar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        quitar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
      };
      const mkBtn = (clave: keyof typeof SVGS, aria: string, clase = ''): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `nota-img__btn ${clase}`.trim();
        b.setAttribute('aria-label', aria);
        b.title = aria;
        b.innerHTML = SVGS[clave];
        return b;
      };
      const btnFull = mkBtn('full', 'Pantalla completa');
      const btnCopiar = mkBtn('copiar', 'Copiar imagen');
      const btnQuitar = mkBtn('quitar', 'Quitar', 'nota-img__btn--danger');
      barra.append(btnFull, btnCopiar, btnQuitar);
      wrapper.appendChild(barra);

      let urlActual = '';
      const rutaOriginal = (node.attrs['src'] as string) ?? '';
      const nombreArchivo = decodeURIComponent(rutaOriginal.split('/').pop() ?? 'imagen')
        .replace(/^nota-img:/, '').slice(0, 40);
      meta.textContent = nombreArchivo;

      this.options
        .resolverUrl(rutaOriginal)
        .then((url: string) => {
          urlActual = url;
          img.src = url;
          img.onload = () => {
            estado.remove();
            if (img.naturalWidth) meta.textContent = `${nombreArchivo} · ${img.naturalWidth}×${img.naturalHeight}`;
          };
          img.onerror = () => { estado.textContent = 'No se pudo cargar la imagen.'; };
        })
        .catch(() => {
          estado.textContent = 'No se pudo cargar la imagen.';
        });

      const copiar = async (btn: HTMLButtonElement) => {
        if (!urlActual) return;
        try {
          await this.options.copiarAlPortapapeles(urlActual);
          const original = btn.textContent;
          btn.textContent = 'Imagen copiada';
          setTimeout(() => { btn.textContent = original; }, 1800);
        } catch {
          this.options.descargar(urlActual, 'imagen.png');
          btn.textContent = 'Descargar imagen';
        }
      };

      const quitar = () => {
        if (!confirm(CONFIRM_QUITAR)) return;
        this.options.onQuitar(rutaOriginal);
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      };

      // ── CT2 — visor a pantalla completa (overlay propio: el NodeView vive
      // fuera del árbol de componentes Angular, así que no puede reusar
      // <app-lightbox> directamente). Esc y clic fuera cierran. ──
      const abrirPantallaCompleta = () => {
        if (!urlActual) return;
        // DB2 — visor con flechas: navega entre TODAS las imágenes ya cargadas de
        // la nota (las consecutivas se ven como galería en la miniatura).
        const todas = Array.from(editor.view.dom.querySelectorAll<HTMLImageElement>('.nota-img__img'))
          .filter((i) => !!i.src);
        let idx = Math.max(0, todas.indexOf(img));

        const overlay = document.createElement('div');
        overlay.className = 'nota-img-visor';
        const imgFull = document.createElement('img');
        imgFull.className = 'nota-img-visor__img';
        const contador = document.createElement('span');
        contador.className = 'nota-img-visor__contador';
        const pintar = () => {
          const actual = todas[idx] ?? img;
          imgFull.src = actual.src;
          imgFull.alt = actual.alt;
          contador.textContent = todas.length > 1 ? `${idx + 1} / ${todas.length}` : '';
        };
        const mover = (delta: number) => {
          if (todas.length < 2) return;
          idx = (idx + delta + todas.length) % todas.length;
          pintar();
        };
        pintar();

        const barra = document.createElement('div');
        barra.className = 'nota-img-visor__barra';
        const mk = (texto: string, clase = '') => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `nota-img-visor__btn ${clase}`.trim();
          b.textContent = texto;
          return b;
        };
        const bCopiar = mk('Copiar');
        const bDescargar = mk('Descargar');
        const bQuitar = mk('Quitar', 'nota-img-visor__btn--danger');
        const bCerrar = mk('Cerrar');
        barra.append(contador, bCopiar, bDescargar, bQuitar, bCerrar);

        const mkFlecha = (lado: 'prev' | 'next') => {
          const f = document.createElement('button');
          f.type = 'button';
          f.className = `nota-img-visor__flecha nota-img-visor__flecha--${lado}`;
          f.setAttribute('aria-label', lado === 'prev' ? 'Imagen anterior' : 'Imagen siguiente');
          f.innerHTML = lado === 'prev'
            ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
            : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
          f.addEventListener('click', (e) => { e.stopPropagation(); mover(lado === 'prev' ? -1 : 1); });
          return f;
        };
        overlay.append(imgFull, barra);
        if (todas.length > 1) overlay.append(mkFlecha('prev'), mkFlecha('next'));
        document.body.appendChild(overlay);

        const cerrar = () => {
          overlay.remove();
          document.removeEventListener('keydown', onKey);
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') cerrar();
          if (e.key === 'ArrowLeft') mover(-1);
          if (e.key === 'ArrowRight') mover(1);
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
        bCerrar.addEventListener('click', cerrar);
        bCopiar.addEventListener('click', () => void copiar(bCopiar));
        bDescargar.addEventListener('click', () => this.options.descargar(imgFull.src, 'imagen.png'));
        bQuitar.addEventListener('click', () => { cerrar(); quitar(); });
      };

      img.addEventListener('click', abrirPantallaCompleta);
      btnFull.addEventListener('click', (e) => { e.preventDefault(); abrirPantallaCompleta(); });
      btnCopiar.addEventListener('click', (e) => { e.preventDefault(); void copiar(btnCopiar); });
      btnQuitar.addEventListener('click', (e) => { e.preventDefault(); quitar(); });

      return { dom: wrapper };
    };
  },
});
