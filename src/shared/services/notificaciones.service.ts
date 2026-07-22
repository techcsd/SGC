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

  // R5 — conteos desglosados por submódulo (badge en cada nav-child).
  // Claves tipo 'flota.checklists', 'inventario.salidas', etc.
  private _pendingBySubmodulo = signal<Record<string, number>>({});
  pendingBySubmodulo = this._pendingBySubmodulo.asReadonly();

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
    if (this.userService.hasModulo('flota') || isAdmin) {
      // Flota v2: avisos operativos pendientes (bloqueos, hallazgos, pre-citas,
      // mantenimiento vencido, consumo anormal, vencimientos) -> badge en Flota.
      checks.push(this.loadAvisosFlota());
    }
    if (this.userService.hasModulo('direccion') || isAdmin) {
      // A4: alertas antifraude abiertas -> badge en Dirección.
      checks.push(this.loadAlertasCuadre());
    }
    if (this.userService.hasModulo('rrhh') || isAdmin) {
      checks.push(this.loadCount('solicitudes_ausencia', 'pendiente', 'rrhh'));
    }
    // Severe-weather alerts (Intelligent Context System): active alerts across
    // obras, shown on the Proyectos nav. Same audience as the weather panels.
    if (this.userService.hasModulo('proyectos') || this.userService.hasModulo('bitacora') || isAdmin) {
      checks.push(this.loadWeatherAlertas());
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
    // R5 — las requisiciones de material pendientes se atienden en Salidas.
    if (table === 'solicitudes_material') {
      this._pendingBySubmodulo.update((m) => ({ ...m, 'inventario.salidas': count ?? 0 }));
    }
  }

  private async loadTareasPendientes(usuarioId: string): Promise<void> {
    const { count } = await this.supabase.client
      .from('tareas')
      .select('id', { count: 'exact', head: true })
      .eq('asignado_a', usuarioId)
      .in('estado', ['pendiente', 'en_progreso']);
    this._pendingByModulo.update((m) => ({ ...m, tareas: count ?? 0 }));
  }

  private async loadAvisosFlota(): Promise<void> {
    // R5 — desglosa los avisos pendientes por tipo hacia cada submódulo, para que
    // el badge de Flota (padre) coincida con la suma de sus hijos.
    const { data } = await this.supabase.client
      .from('avisos_flota')
      .select('tipo')
      .eq('estado', 'pendiente');
    const filas = (data ?? []) as { tipo: string }[];
    // tipo → submódulo donde se atiende ese aviso.
    const mapa: Record<string, string> = {
      bloqueo_critico: 'flota.checklists',
      hallazgos: 'flota.checklists',
      mantenimiento_vencido: 'flota.mantenimientos',
      pre_cita: 'flota.mantenimientos',
      consumo_anormal: 'flota.combustible',
      // T1 — cada tipo de aviso a su submódulo real (antes caían al default flota.avisos).
      reporte_semanal: 'flota.reporte-semanal',
      conciliacion: 'flota.conciliacion',
      licencia: 'flota.avisos',
      matricula: 'flota.avisos',
      seguro: 'flota.avisos',
    };
    const sub: Record<string, number> = {
      'flota.checklists': 0,
      'flota.mantenimientos': 0,
      'flota.combustible': 0,
      'flota.reporte-semanal': 0,
      'flota.conciliacion': 0,
      'flota.avisos': 0,
    };
    for (const f of filas) {
      const key = mapa[f.tipo] ?? 'flota.avisos';
      sub[key] = (sub[key] ?? 0) + 1;
    }
    this._pendingByModulo.update((m) => ({ ...m, flota: filas.length }));
    this._pendingBySubmodulo.update((m) => ({ ...m, ...sub }));
  }

  private async loadAlertasCuadre(): Promise<void> {
    const { count } = await this.supabase.client
      .from('alertas_cuadre')
      .select('id', { count: 'exact', head: true })
      .neq('estado', 'resuelta');
    this._pendingByModulo.update((m) => ({ ...m, direccion: count ?? 0 }));
  }

  private async loadWeatherAlertas(): Promise<void> {
    const { count } = await this.supabase.client
      .from('weather_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('vigente', true);
    this._pendingByModulo.update((m) => ({ ...m, proyectos: count ?? 0 }));
  }

  private async loadMensajesNoLeidos(): Promise<void> {
    const { data } = await this.supabase.client.rpc('contar_mensajes_no_leidos');
    this._pendingByModulo.update((m) => ({ ...m, mensajes: (data as number) ?? 0 }));
  }

  clear(): void {
    this._pendingByModulo.set({});
    this._pendingBySubmodulo.set({});
  }
}
