import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** AF38 — orden guardado de una sección del menú. */
export interface ModuloOrden {
  clave: string;
  etiqueta: string | null;
  orden: number;
}

/**
 * AF38 — secciones del menú reordenables, en su orden por defecto. La `clave`
 * coincide con `NavItem.label` en el shell (que ordena por ella). "Administración"
 * se renderiza aparte y no se reordena.
 */
export const NAV_SECCIONES: string[] = [
  'Dashboard', 'Dirección', 'Inventario', 'Compras', 'RRHH', 'Proyectos', 'Flota',
  'Bitácora', 'Documentos', 'Legal', 'Tareas', 'Tecnología', 'Mensajes', 'Notas',
  'CSD App (móvil)', 'Soporte', 'Dudas',
];

@Injectable({ providedIn: 'root' })
export class ModuloOrdenService {
  private supabase = inject(SupabaseService);

  /** Mapa clave → orden. Vacío si no se ha configurado (el shell conserva el orden por defecto). */
  async getOrdenMap(): Promise<Record<string, number>> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('modulo_orden')
      .select('clave, orden');
    if (error) throw new Error(error.message);
    const map: Record<string, number> = {};
    for (const r of (data ?? []) as { clave: string; orden: number }[]) map[r.clave] = r.orden;
    return map;
  }

  async getAll(): Promise<ModuloOrden[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('modulo_orden')
      .select('*')
      .order('orden');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ModuloOrden[];
  }

  /** Reemplaza el orden completo (upsert por clave). */
  async guardar(items: ModuloOrden[]): Promise<void> {
    if (!items.length) return;
    const rows = items.map((it, i) => ({ clave: it.clave, etiqueta: it.etiqueta, orden: i, updated_at: new Date().toISOString() }));
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('modulo_orden')
      .upsert(rows, { onConflict: 'clave' });
    if (error) throw new Error(error.message);
  }
}
