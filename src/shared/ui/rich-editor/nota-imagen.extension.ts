import Image from '@tiptap/extension-image';

/**
 * CS2 — imagen pegada/arrastrada en una nota. Reusa el nodo `image` estándar
 * (así el Markdown sigue siendo `![alt](src)`, sin tocar `tiptap-markdown`) pero
 * con un `NodeView` casero: el `src` que se guarda es `nota-img:<ruta>` (nunca
 * una URL firmada, que caduca) y este NodeView la resuelve a una URL mostrable
 * al vuelo, con un botón «Copiar imagen» (portapapeles) y «Quitar».
 */
export interface NotaImagenOptions {
  resolverUrl: (src: string) => Promise<string>;
  copiarAlPortapapeles: (url: string) => Promise<void>;
  descargar: (url: string, nombre: string) => void;
  /** Se llama al pulsar «Quitar» — borra el archivo de Storage (best-effort). */
  onQuitar: (src: string) => void;
}

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

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'nota-img';
      wrapper.contentEditable = 'false';

      const img = document.createElement('img');
      img.alt = (node.attrs['alt'] as string) ?? '';
      img.className = 'nota-img__img';
      wrapper.appendChild(img);

      const estado = document.createElement('div');
      estado.className = 'nota-img__estado';
      estado.textContent = 'Subiendo imagen…';
      wrapper.appendChild(estado);

      const toolbar = document.createElement('div');
      toolbar.className = 'nota-img__toolbar';
      const btnCopiar = document.createElement('button');
      btnCopiar.type = 'button';
      btnCopiar.className = 'nota-img__btn';
      btnCopiar.textContent = 'Copiar imagen';
      const btnQuitar = document.createElement('button');
      btnQuitar.type = 'button';
      btnQuitar.className = 'nota-img__btn nota-img__btn--danger';
      btnQuitar.textContent = 'Quitar';
      toolbar.append(btnCopiar, btnQuitar);
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

      btnCopiar.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!urlActual) return;
        try {
          await this.options.copiarAlPortapapeles(urlActual);
          const original = btnCopiar.textContent;
          btnCopiar.textContent = 'Imagen copiada';
          setTimeout(() => { btnCopiar.textContent = original; }, 1800);
        } catch {
          this.options.descargar(urlActual, 'imagen.png');
          btnCopiar.textContent = 'Descargar imagen';
        }
      });

      btnQuitar.addEventListener('click', (e) => {
        e.preventDefault();
        this.options.onQuitar(rutaOriginal);
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      });

      return { dom: wrapper };
    };
  },
});
