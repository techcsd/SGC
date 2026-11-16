import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

interface ConducePorCerrar {
  id: string; codigo: string; created_at: string; dias_abierto: number; estado: string;
  despachante: string | null; destino_texto: string | null; tiene_confirmaciones: boolean;
}
interface SolicitudAtascada {
  id: string; folio: string | null; obra: string | null; solicitante: string | null;
  urgencia: string | null; edad_horas: number; escalada: boolean;
}

/** DS-33/DS-34 (#56, #58) — lo que lleva demasiado tiempo abierto: solicitudes de material sin aprobar y conduces
 *  despachados sin cierre. Solo lectura, más antiguos primero; los RPC filtran por rol (admin o módulo inventario). */
@Component({
  selector: 'app-pendientes-cierre',
  imports: [RouterLink, Skeleton, TranslatePipe],
  templateUrl: './pendientes-cierre.html',
  styleUrl: './pendientes-cierre.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendientesCierre implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  loading = signal(true);
  conduces = signal<ConducePorCerrar[]>([]);
  solicitudes = signal<SolicitudAtascada[]>([]);
  diasMin = signal(0);

  async ngOnInit() {
    await this.cargar();
  }

  async cambiarDias(d: number) {
    this.diasMin.set(d);
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    try {
      const [c, s] = await Promise.all([
        this.supabase.client.rpc('conduces_por_cerrar', { p_dias_min: this.diasMin() }),
        this.supabase.client.rpc('solicitudes_material_pendientes_reporte'),
      ]);
      if (c.error) throw new Error(c.error.message);
      if (s.error) throw new Error(s.error.message);
      this.conduces.set((c.data ?? []) as ConducePorCerrar[]);
      this.solicitudes.set((s.data ?? []) as SolicitudAtascada[]);
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  edadLegible(horas: number): string {
    return horas >= 48 ? `${Math.floor(horas / 24)} d` : `${horas} h`;
  }
}
