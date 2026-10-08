import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

interface SolicitudEliminacion {
  id: string;
  usuario_id: string | null;
  identificador: string | null;
  motivo: string | null;
  origen: string;
  estado: string;
  creada_at: string;
  procesada_at: string | null;
  nota_admin: string | null;
  usuario?: { nombre: string | null; email: string | null } | null;
}

/**
 * CI4 — Bandeja de solicitudes de eliminación de cuenta. El admin procesa
 * (anonimiza + banea vía edge admin-procesar-eliminacion) o rechaza con nota.
 */
@Component({
  selector: 'app-admin-solicitudes-eliminacion',
  imports: [DatePipe],
  templateUrl: './solicitudes-eliminacion.html',
  styleUrl: './solicitudes-eliminacion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSolicitudesEliminacion implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  cargando = signal(true);
  solicitudes = signal<SolicitudEliminacion[]>([]);
  procesandoId = signal<string | null>(null);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('solicitudes_eliminacion_cuenta')
        .select('*, usuario:usuarios!usuario_id(nombre,email)')
        .order('creada_at', { ascending: false });
      if (error) throw error;
      this.solicitudes.set((data ?? []) as unknown as SolicitudEliminacion[]);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudieron cargar las solicitudes');
    } finally {
      this.cargando.set(false);
    }
  }

  pendientes() {
    return this.solicitudes().filter((s) => s.estado === 'pendiente').length;
  }

  async procesar(s: SolicitudEliminacion, accion: 'procesar' | 'rechazar') {
    if (this.procesandoId()) return;
    const nota = accion === 'rechazar'
      ? (window.prompt('Motivo del rechazo (opcional):') ?? '')
      : '';
    if (accion === 'procesar' &&
        !window.confirm('¿Procesar la eliminación? Se anonimiza el perfil y se cierra el acceso del usuario. Es irreversible.')) {
      return;
    }
    this.procesandoId.set(s.id);
    try {
      const { error } = await this.supabase.client.functions.invoke('admin-procesar-eliminacion', {
        body: { solicitudId: s.id, accion, nota },
      });
      if (error) throw error;
      this.toast.success('Listo', accion === 'procesar' ? 'Cuenta eliminada y anonimizada.' : 'Solicitud rechazada.');
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo procesar la solicitud');
    } finally {
      this.procesandoId.set(null);
    }
  }
}
