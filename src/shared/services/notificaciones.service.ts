import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { UserService } from '../../app/core/services/user.service';

/** Pending-count badges shown on the nav (red dot on Inventario/Compras/Bitácora).
 *  Shell reads this on init; every service call that creates/approves/rejects a
 *  solicitud or dispatches/confirms a salida calls refresh() so the badge updates
 *  immediately instead of only on the next full page load. */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private supabase = inject(SupabaseService);
  private userService = inject(UserService);

  private _pendingByModulo = signal<Record<string, number>>({});
  pendingByModulo = this._pendingByModulo.asReadonly();

  async refresh(): Promise<void> {
    const isAdmin = this.userService.hasRole('admin');
    const checks: Promise<void>[] = [];

    if (this.userService.hasModulo('inventario') || isAdmin) {
      checks.push(this.loadCount('solicitudes_material', 'pendiente', 'inventario'));
    }
    if (this.userService.hasModulo('compras') || isAdmin) {
      checks.push(this.loadCount('solicitudes_compra', 'pendiente', 'compras'));
    }
    if (this.userService.hasModulo('bitacora') || isAdmin) {
      // RLS already scopes this to the caller's own project(s) for an
      // engineer, or every despachado delivery for admin/inventario.
      checks.push(this.loadCount('salidas_inventario', 'despachado', 'bitacora'));
    }
    if (this.userService.hasModulo('legal') || isAdmin) {
      checks.push(this.loadCount('aprobaciones_legales', 'pendiente', 'legal'));
    }
    if (this.userService.hasModulo('rrhh') || isAdmin) {
      checks.push(this.loadCount('solicitudes_ausencia', 'pendiente', 'rrhh'));
    }
    // Tareas badge is per-user (tasks assigned to me that are still open),
    // not module-gated — every user can be assigned tasks.
    const userId = this.userService.profile()?.id;
    if (userId) {
      checks.push(this.loadTareasPendientes(userId));
      checks.push(this.loadMensajesNoLeidos());
    }

    await Promise.all(checks);
  }

  private async loadCount(table: string, estado: string, modulo: string): Promise<void> {
    const { count } = await this.supabase.client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('estado', estado);
    this._pendingByModulo.update((m) => ({ ...m, [modulo]: count ?? 0 }));
  }

  private async loadTareasPendientes(usuarioId: string): Promise<void> {
    const { count } = await this.supabase.client
      .from('tareas')
      .select('id', { count: 'exact', head: true })
      .eq('asignado_a', usuarioId)
      .in('estado', ['pendiente', 'en_progreso']);
    this._pendingByModulo.update((m) => ({ ...m, tareas: count ?? 0 }));
  }

  private async loadMensajesNoLeidos(): Promise<void> {
    const { data } = await this.supabase.client.rpc('contar_mensajes_no_leidos');
    this._pendingByModulo.update((m) => ({ ...m, mensajes: (data as number) ?? 0 }));
  }

  clear(): void {
    this._pendingByModulo.set({});
  }
}
