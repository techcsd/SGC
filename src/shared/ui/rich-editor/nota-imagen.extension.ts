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

      const toolbar = document.createElement('div');
      toolbar.className = 'nota-img__toolbar';
      const btnFull = document.createElement('button');
      btnFull.type = 'button';
      btnFull.className = 'nota-img__btn';
      btnFull.textContent = 'Pantalla completa';
      const btnCopiar = document.createElement('button');
      btnCopiar.type = 'button';
      btnCopiar.className = 'nota-img__btn';
      btnCopiar.textContent = 'Copiar imagen';
      const btnQuitar = document.createElement('button');
      btnQuitar.type = 'button';
      btnQuitar.className = 'nota-img__btn nota-img__btn--danger';
      btnQuitar.textContent = 'Quitar';
      toolbar.append(btnFull, btnCopiar, btnQuitar);
      wrapper.appendChild(toolbar);

      let urlActual = '';
      const rutaOriginal = (node.attrs['src'] as string) ?? '';

      this.options
        .resolverUrl(rutaOriginal)
        .then((url: string) => {
          urlActual = url;
          img.src = url;
          img.onload = () => estado.remove();
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
        const overlay = document.createElement('div');
        overlay.className = 'nota-img-visor';
        const imgFull = document.createElement('img');
        imgFull.className = 'nota-img-visor__img';
        imgFull.src = urlActual;
        imgFull.alt = img.alt;
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
        barra.append(bCopiar, bDescargar, bQuitar, bCerrar);
        overlay.append(imgFull, barra);
        document.body.appendChild(overlay);

        const cerrar = () => {
          overlay.remove();
          document.removeEventListener('keydown', onKey);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
        bCerrar.addEventListener('click', cerrar);
        bCopiar.addEventListener('click', () => void copiar(bCopiar));
        bDescargar.addEventListener('click', () => this.options.descargar(urlActual, 'imagen.png'));
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
