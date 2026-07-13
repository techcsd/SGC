import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Router } from '@angular/router';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { UserService } from '../../app/core/services/user.service';
import { ToastService } from './toast.service';
import { NotificacionesService } from './notificaciones.service';

/** Subscribes (once, app-wide) to the realtime tables and raises on-screen
 *  toasts + refreshes nav badges when something relevant to the current user
 *  happens — no page refresh needed. Realtime respects RLS, so a subscriber
 *  only receives rows they can already SELECT. */
@Injectable({ providedIn: 'root' })
export class RealtimeNotificacionesService {
  private supabase = inject(SupabaseService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private notificaciones = inject(NotificacionesService);
  private router = inject(Router);

  private channels: RealtimeChannel[] = [];
  private started = false;

  start() {
    const userId = this.userService.profile()?.id;
    if (this.started || !userId) return;
    this.started = true;

    const isAdmin = this.userService.hasRole('admin');

    // ── Tareas: new assignment to me → toast; any change → refresh badge ──
    this.channels.push(
      this.supabase.client
        .channel('rt-tareas')
        .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'tareas' }, (p) => {
          const t = p.new as { asignado_a: string; asignado_por: string; titulo: string };
          if (t.asignado_a === userId && t.asignado_por !== userId) {
            this.toast.info('Nueva tarea asignada', t.titulo, '/tareas/mis-tareas');
          }
          this.notificaciones.refresh();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'sgc', table: 'tareas' }, () => {
          this.notificaciones.refresh();
        })
        .subscribe(),
    );

    // ── Mensajes: new message from someone else → toast (unless already on chat) ──
    this.channels.push(
      this.supabase.client
        .channel('rt-mensajes-global')
        .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'mensajes' }, (p) => {
          const m = p.new as { autor_id: string };
          if (m.autor_id !== userId) {
            if (!this.router.url.startsWith('/mensajes')) {
              this.toast.info('Nuevo mensaje', undefined, '/mensajes');
            }
            this.notificaciones.refresh();
          }
        })
        .subscribe(),
    );

    // ── Legal approvals (for legal/admin) ──
    if (isAdmin || this.userService.hasModulo('legal')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-aprobaciones')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'aprobaciones_legales' }, (p) => {
            const a = p.new as { titulo: string; solicitado_por: string };
            if (a.solicitado_por !== userId) {
              this.toast.warning('Nueva solicitud de aprobación legal', a.titulo, '/legal/aprobaciones');
            }
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Leave requests (for rrhh/admin) ──
    if (isAdmin || this.userService.hasModulo('rrhh')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-ausencias')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'solicitudes_ausencia' }, (p) => {
            const a = p.new as { solicitado_por: string };
            if (a.solicitado_por !== userId) {
              this.toast.warning('Nueva solicitud de ausencia', 'Revisa RRHH → Ausencias', '/rrhh/ausencias');
            }
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Requisiciones (materiales) → bandeja de Almacén (inventario/admin) ──
    if (isAdmin || this.userService.hasModulo('inventario')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-requisiciones')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'solicitudes_material' }, (p) => {
            const s = p.new as { solicitante_id: string };
            if (s.solicitante_id !== userId) {
              this.toast.info('Nueva requisición', 'Revisa Inventario → Salidas', '/inventario/salidas');
            }
            this.notificaciones.refresh();
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'sgc', table: 'solicitudes_material' }, () => {
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Solicitudes de compra (incl. auto-generadas por faltante) → Compras/admin ──
    if (isAdmin || this.userService.hasModulo('compras')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-solicitudes-compra')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'solicitudes_compra' }, (p) => {
            const s = p.new as { origen_requisicion_id: string | null };
            this.toast.info(
              'Nueva solicitud de compra',
              s.origen_requisicion_id ? 'Generada por el faltante de una requisición' : 'Revisa Compras → Órdenes',
              '/compras/ordenes',
            );
            this.notificaciones.refresh();
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'sgc', table: 'solicitudes_compra' }, () => {
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Checklists de flota con ítem crítico en NO → alerta operativa (flota/admin) ──
    if (isAdmin || this.userService.hasModulo('flota')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-checklists-flota')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'checklists_vehiculo' }, (p) => {
            const c = p.new as { tiene_criticos: boolean };
            if (c.tiene_criticos) {
              this.toast.warning(
                'Checklist con ítem crítico',
                'Un vehículo reportó un punto crítico en NO. Revisa Flota → Checklists.',
                '/flota/checklists',
              );
            }
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Alertas antifraude de control de materiales (dirección/gerencia/admin) ──
    if (isAdmin || this.userService.hasModulo('direccion')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-alertas-cuadre')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'alertas_cuadre' }, (p) => {
            const a = p.new as { severidad: string };
            this.toast.warning(
              a.severidad === 'alerta' ? 'Alerta de control de materiales' : 'Advertencia de control de materiales',
              'Revisa el panel de Dirección.',
              '/direccion',
            );
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }

    // ── Severe-weather alerts (for proyectos/bitacora/admin) ──
    if (isAdmin || this.userService.hasModulo('proyectos') || this.userService.hasModulo('bitacora')) {
      this.channels.push(
        this.supabase.client
          .channel('rt-weather-alerts')
          .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'weather_alerts' }, (p) => {
            const a = p.new as { titulo: string; detalle: string };
            this.toast.warning(`Alerta climática: ${a.titulo}`, a.detalle, '/proyectos/clima');
            this.notificaciones.refresh();
          })
          .subscribe(),
      );
    }
  }

  stop() {
    for (const ch of this.channels) {
      void this.supabase.client.removeChannel(ch);
    }
    this.channels = [];
    this.started = false;
  }
}
