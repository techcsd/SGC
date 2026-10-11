import { Injectable, signal } from '@angular/core';

export interface LightboxEstado {
  src: string;
  alt: string;
  title: string;
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
    this.estado.set({ src, alt: alt || title || 'Imagen', title });
  }
  cerrar() { this.estado.set(null); }
}
