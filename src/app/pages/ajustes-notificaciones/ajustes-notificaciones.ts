import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NotificacionesCentroService } from '../../../shared/services/notificaciones-centro.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';

/** AT23 — categorías informativas que el usuario puede silenciar. A propósito se
 *  dejan fuera las que exigen acción (firmas, alertas críticas, errores). Espejo
 *  de la lista de la app (csd-app: CATEGORIAS_NOTIF). */
const CATEGORIAS_NOTIF: { tipo: string; label: string; desc: string }[] = [
  { tipo: 'version_publicada', label: 'Nuevas versiones', desc: 'Avisos cuando se publica una actualización del sistema.' },
  { tipo: 'material_no_catalogado', label: 'Material no catalogado', desc: 'Cuando llega material sin artículo del catálogo.' },
  { tipo: 'otros_valor', label: 'Valores fuera de catálogo', desc: 'Texto libre capturado que podría convertirse en artículo.' },
  { tipo: 'solicitud_movimiento', label: 'Solicitudes de movimiento', desc: 'Pedidos de transporte de material/equipo.' },
  { tipo: 'flota', label: 'Avisos de flota', desc: 'Consumo, mantenimiento, vencimientos y otras novedades de vehículos.' },
  { tipo: 'transporte', label: 'Transporte y rutas', desc: 'Cambios en rutas y estados de conductores.' },
  { tipo: 'conduce', label: 'Conduces', desc: 'Movimientos de conduces que no requieren tu firma.' },
  { tipo: 'novedad', label: 'Novedades', desc: 'Anuncios generales del sistema.' },
];

/**
 * AT23 — Ajustes › Notificaciones. Cada usuario silencia los TIPOS de aviso que no
 * le aportan. Solo afecta SU bandeja y SU badge (no cambia a quién le llega el
 * evento). Backend: mis_notif_prefs / set_notif_pref.
 */
@Component({
  selector: 'app-ajustes-notificaciones',
  imports: [RouterLink, Skeleton],
  templateUrl: './ajustes-notificaciones.html',
  styleUrl: './ajustes-notificaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AjustesNotificaciones implements OnInit {
  private centro = inject(NotificacionesCentroService);
  private toast = inject(ToastService);

  readonly categorias = CATEGORIAS_NOTIF;
  loading = signal(true);
  guardando = signal<string | null>(null);
  /** Tipos silenciados del usuario. */
  private silenciados = signal<Set<string>>(new Set());

  async ngOnInit() {
    try {
      const prefs = await this.centro.misNotifPrefs();
      const s = new Set<string>();
      for (const p of prefs) if (p.silenciado) s.add(p.tipo);
      this.silenciados.set(s);
    } catch {
      /* best-effort: sin prefs, todo activo */
    } finally {
      this.loading.set(false);
    }
  }

  /** El switch muestra "recibir" (ON = NO silenciado). */
  recibe(tipo: string): boolean {
    return !this.silenciados().has(tipo);
  }

  async toggle(tipo: string) {
    if (this.guardando()) return;
    const silenciar = this.recibe(tipo); // si actualmente recibe, ahora silencia
    this.guardando.set(tipo);
    // Optimista.
    this.silenciados.update((s) => {
      const next = new Set(s);
      if (silenciar) next.add(tipo);
      else next.delete(tipo);
      return next;
    });
    try {
      await this.centro.setNotifPref(tipo, silenciar);
    } catch (e) {
      // Revertir en error.
      this.silenciados.update((s) => {
        const next = new Set(s);
        if (silenciar) next.delete(tipo);
        else next.add(tipo);
        return next;
      });
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(null);
    }
  }
}
