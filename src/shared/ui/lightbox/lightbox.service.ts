import { Injectable, signal } from '@angular/core';

export interface LightboxEstado {
  src: string;
  alt: string;
  title: string;
  /** CX3.4/CX5 — galería: todas las URLs del grupo (reporte/requisición) + índice inicial. */
  images: string[];
  startIndex: number;
}

/**
 * CM5 — servicio del visor de imágenes. Un solo `<app-lightbox>` montado en el shell
 * escucha esta señal; `appVerFoto` (y quien quiera) lo abre con `abrir()`.
 */
@Injectable({ providedIn: 'root' })
export class LightboxService {
  estado = signal<LightboxEstado | null>(null);

  abrir(src: string, title = '', alt = 'Imagen') {
    if (!src) return;
    this.estado.set({ src, alt: alt || title || 'Imagen', title, images: [], startIndex: 0 });
  }

  /** CX3.4/CX5 — abre con flechas + contador cuando `images` trae más de una URL. */
  abrirGaleria(images: string[], index = 0, title = '', alt = 'Imagen') {
    const lista = (images ?? []).filter(Boolean);
    if (!lista.length) return;
    const i = Math.min(Math.max(index, 0), lista.length - 1);
    this.estado.set({ src: lista[i], alt: alt || title || 'Imagen', title, images: lista, startIndex: i });
  }

  cerrar() { this.estado.set(null); }
}
