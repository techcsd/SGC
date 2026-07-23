import { Injectable } from '@angular/core';

/** Metadatos de un borrador guardado (para la lista "En proceso"). */
export interface BorradorMeta {
  id: string;
  modulo: string;
  label: string;
  savedAt: string; // ISO
}

/**
 * X13 — borradores web multi-instancia (paridad con la app, versión ligera).
 * Guarda formularios largos incompletos en localStorage (sobrevive al cierre de
 * pestaña, a diferencia de sessionStorage) para retomarlos desde una sección
 * "En proceso". No persiste archivos (limitación aceptada para el back-office).
 * Genérico por `modulo` para poder reutilizarlo en otros formularios.
 */
@Injectable({ providedIn: 'root' })
export class BorradoresWebService {
  private indexKey(modulo: string): string {
    return `sgc.borradores.${modulo}`;
  }
  private itemKey(modulo: string, id: string): string {
    return `sgc.borrador.${modulo}.${id}`;
  }

  /** Lista de borradores del módulo, más recientes primero. */
  list(modulo: string): BorradorMeta[] {
    try {
      const raw = localStorage.getItem(this.indexKey(modulo));
      const arr = raw ? (JSON.parse(raw) as BorradorMeta[]) : [];
      return arr.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    } catch {
      return [];
    }
  }

  /** Guarda/actualiza un borrador y su entrada en el índice. */
  save(modulo: string, id: string, label: string, payload: unknown): void {
    try {
      localStorage.setItem(this.itemKey(modulo, id), JSON.stringify(payload));
      const list = this.list(modulo).filter((b) => b.id !== id);
      // savedAt se pasa desde el caller para no usar Date en horarios raros;
      // aquí usamos el reloj local del navegador (contexto UI, es aceptable).
      list.unshift({ id, modulo, label, savedAt: new Date().toISOString() });
      localStorage.setItem(this.indexKey(modulo), JSON.stringify(list));
    } catch {
      /* sin storage / cuota: el borrador simplemente no persiste */
    }
  }

  get<T = unknown>(modulo: string, id: string): T | null {
    try {
      const raw = localStorage.getItem(this.itemKey(modulo, id));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  remove(modulo: string, id: string): void {
    try {
      localStorage.removeItem(this.itemKey(modulo, id));
      const list = this.list(modulo).filter((b) => b.id !== id);
      localStorage.setItem(this.indexKey(modulo), JSON.stringify(list));
    } catch {
      /* no-op */
    }
  }
}
