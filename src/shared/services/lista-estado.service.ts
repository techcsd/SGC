import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/**
 * CX3.2 — recuerda filtros/pestaña/página/búsqueda de una lista MIENTRAS la
 * persona siga en el mismo módulo (p. ej. Inventario). Se limpia solo al pasar a
 * otro módulo (primer segmento de la URL) o al cerrar sesión (`limpiarTodo()`,
 * llamado desde AuthService.signOut) — nunca "para siempre": reporte de Raykler,
 * "al momento de colocar un filtro y luego entro a un conduce este pierde el
 * filtro cuando debe mantenerlo hasta que cambio de modulo".
 *
 * Uso en una pantalla con señales de filtro:
 *   ngOnInit() {
 *     const guardado = this.listaEstado.obtener<MiFiltros>('inventario.conduces');
 *     if (guardado) { this.tab.set(guardado.tab); this.searchQuery.set(guardado.q); ... }
 *   }
 *   private guardarEstado() {
 *     this.listaEstado.guardar('inventario.conduces', { tab: this.tab(), q: this.searchQuery(), ... });
 *   }
 *   // llamar guardarEstado() en cada setter de filtro/pestaña/página.
 */
@Injectable({ providedIn: 'root' })
export class ListaEstadoService {
  private router = inject(Router);
  private estados = new Map<string, unknown>();
  private moduloActual: string | null = null;

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      const modulo = this.moduloDeUrl(e.urlAfterRedirects);
      if (modulo !== this.moduloActual) {
        this.estados.clear();
        this.moduloActual = modulo;
      }
    });
  }

  private moduloDeUrl(url: string): string {
    const seg = url.split('?')[0].split('/').filter(Boolean);
    return seg[0] ?? '';
  }

  guardar<T>(pantalla: string, estado: T): void {
    this.estados.set(pantalla, estado);
  }

  obtener<T>(pantalla: string): T | undefined {
    return this.estados.get(pantalla) as T | undefined;
  }

  limpiar(pantalla: string): void {
    this.estados.delete(pantalla);
  }

  /** Llamado al cerrar sesión (AuthService.signOut) — nada de un usuario se queda para el siguiente. */
  limpiarTodo(): void {
    this.estados.clear();
    this.moduloActual = null;
  }
}
