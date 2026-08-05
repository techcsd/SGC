import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { NotificacionesConfigService, NotificacionEventoConfig } from '../../../../shared/services/notificaciones-config.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * AG14 — Configuración de notificaciones (Administración): qué eventos avisan al
 * admin y por qué canal (in-app / push / email). Al desactivar un evento deja de
 * notificar (el trigger de BD respeta esta config).
 */
@Component({
  selector: 'app-admin-notificaciones',
  imports: [Skeleton],
  templateUrl: './notificaciones.html',
  styleUrl: './notificaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminNotificaciones implements OnInit {
  private svc = inject(NotificacionesConfigService);
  private toast = inject(ToastService);

  eventos = signal<NotificacionEventoConfig[]>([]);
  loading = signal(true);
  error = signal('');

  async ngOnInit() {
    try {
      this.eventos.set(await this.svc.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la configuración.');
    } finally {
      this.loading.set(false);
    }
  }

  async toggle(ev: NotificacionEventoConfig, campo: 'in_app' | 'push' | 'email' | 'activo') {
    const nuevo = !ev[campo];
    // Optimista
    this.eventos.update((list) => list.map((x) => (x.evento === ev.evento ? { ...x, [campo]: nuevo } : x)));
    try {
      await this.svc.update(ev.evento, { [campo]: nuevo });
    } catch (e: unknown) {
      // revertir
      this.eventos.update((list) => list.map((x) => (x.evento === ev.evento ? { ...x, [campo]: !nuevo } : x)));
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : '');
    }
  }
}
