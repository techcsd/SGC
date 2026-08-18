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
      // AU4 — material no catalogado pendiente de crear/vincular.
      checks.push(this.loadMaterialNoCatalogado());
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
    // Badge de Proyectos = alertas de clima vigentes (audiencia proyectos|bitacora)
    // + avisos de cronograma pendientes (solo proyectos|admin, Y15).
    if (this.userService.hasModulo('proyectos') || this.userService.hasModulo('bitacora') || isAdmin) {
      checks.push(this.loadProyectosBadge(this.userService.hasModulo('proyectos') || isAdmin));
    }
    // Tareas badge is per-user (tasks assigned to me that are still open),
    // not module-gated — every user can be assigned tasks.
    const userId = this.userService.profile()?.id;
    if (userId) {
      checks.push(this.loadTareasPendientes(userId));
      checks.push(this.loadMensajesNoLeidos());
      // AU1 — bandeja "Conduces por firmar" del despachante (per-user, sin gate de
      // módulo: cualquier usuario puede ser elegido despachante).
      checks.push(this.loadConducesPorFirmar());
    }
    // Z29 — reportes de soporte sin atender (RLS: admin ve todos; usuario, los suyos).
    checks.push(this.loadReportesSoporte());

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
    // X12 — las aprobaciones legales pendientes se atienden en el submódulo Aprobaciones.
    if (table === 'aprobaciones_legales') {
      this._pendingBySubmodulo.update((m) => ({ ...m, 'legal.aprobaciones': count ?? 0 }));
    }
    // RRHH: las solicitudes de ausencia pendientes se atienden en Ausencias.
    if (table === 'solicitudes_ausencia') {
      this._pendingBySubmodulo.update((m) => ({ ...m, 'rrhh.ausencias': count ?? 0 }));
    }
    // Compras: las órdenes/solicitudes de compra pendientes se atienden en Órdenes de compra.
    if (table === 'solicitudes_compra') {
      this._pendingBySubmodulo.update((m) => ({ ...m, 'compras.ordenes': count ?? 0 }));
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

  private async loadProyectosBadge(includeCronograma: boolean): Promise<void> {
    const [weatherRes, cronogramaRes] = await Promise.all([
      this.supabase.client
        .from('weather_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('vigente', true),
      includeCronograma
        ? this.supabase.client
            .from('avisos_proyecto')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'pendiente')
            .in('tipo', ['cronograma_por_iniciar', 'cronograma_por_vencer', 'cronograma_atrasada'])
        : Promise.resolve({ count: 0 } as { count: number | null }),
    ]);
    const total = (weatherRes.count ?? 0) + (cronogramaRes.count ?? 0);
    this._pendingByModulo.update((m) => ({ ...m, proyectos: total }));
  }

  /** Z29 — reportes de soporte no resueltos → badge en "Soporte". */
  private async loadReportesSoporte(): Promise<void> {
    const { count } = await this.supabase.client
      .from('reportes_usuario')
      .select('id', { count: 'exact', head: true })
      .neq('estado', 'resuelto');
    this._pendingByModulo.update((m) => ({ ...m, soporte: count ?? 0 }));
  }

  private async loadMensajesNoLeidos(): Promise<void> {
    const { data } = await this.supabase.client.rpc('contar_mensajes_no_leidos');
    this._pendingByModulo.update((m) => ({ ...m, mensajes: (data as number) ?? 0 }));
  }

  /** AU1 — conduces pendientes de la firma del despachante (usuario actual). */
  private async loadConducesPorFirmar(): Promise<void> {
    const { data } = await this.supabase.client.rpc('mis_conduces_por_firmar_count');
    this._pendingByModulo.update((m) => ({ ...m, 'conduces.por_firmar': (data as number) ?? 0 }));
  }

  /** AU4 — material no catalogado pendiente de crear/vincular → badge en Inventario. */
  private async loadMaterialNoCatalogado(): Promise<void> {
    const { data } = await this.supabase.client.rpc('material_no_catalogado_pendientes_count');
    this._pendingBySubmodulo.update((m) => ({ ...m, 'inventario.material_no_catalogado': (data as number) ?? 0 }));
  }

  clear(): void {
    this._pendingByModulo.set({});
    this._pendingBySubmodulo.set({});
  }
}
