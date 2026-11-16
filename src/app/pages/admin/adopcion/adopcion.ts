import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { FechaPipe } from '../../../../shared/i18n/fecha.pipe';

interface AdopcionRol {
  rol: string; rol_codigo: string; total: number; nunca_entraron: number;
  activos_n_dias: number; sin_actividad_n_dias: number;
}
interface UsuarioInactivo {
  usuario_id: string; nombre: string; rol: string | null; ultima_actividad: string | null; dias_sin_entrar: number | null;
}

/** DS-38 (#62/#83) — tablero de adopción por rol: quién nunca entró y quién lleva días sin usar el sistema.
 *  Los RPC re-validan el rol (admin / dirección); excluyen usuarios de prueba. */
@Component({
  selector: 'app-admin-adopcion',
  imports: [Skeleton, TranslatePipe, FechaPipe],
  templateUrl: './adopcion.html',
  styleUrl: './adopcion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAdopcion implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  loading = signal(true);
  roles = signal<AdopcionRol[]>([]);
  inactivos = signal<UsuarioInactivo[]>([]);
  soloNunca = signal(true);

  async ngOnInit() {
    await this.cargar();
  }

  async toggleSoloNunca() {
    this.soloNunca.update((v) => !v);
    await this.cargar();
  }

  private async cargar() {
    this.loading.set(true);
    try {
      const [r, i] = await Promise.all([
        this.supabase.client.rpc('adopcion_por_rol'),
        this.supabase.client.rpc('adopcion_usuarios_inactivos', { p_solo_nunca: this.soloNunca() }),
      ]);
      if (r.error) throw new Error(r.error.message);
      this.roles.set((r.data ?? []) as AdopcionRol[]);
      // La lista nominal es solo para admin: si el RPC la niega (dirección), el resumen por rol sigue visible.
      this.inactivos.set(i.error ? [] : ((i.data ?? []) as UsuarioInactivo[]));
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el tablero de adopción.');
    } finally {
      this.loading.set(false);
    }
  }

  pct(n: number, total: number): number {
    return total > 0 ? Math.round((100 * n) / total) : 0;
  }
}
