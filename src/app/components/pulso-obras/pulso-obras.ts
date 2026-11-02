import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserService } from '../../core/services/user.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

interface ObraPulso {
  obra: string;
  reporto_hoy: boolean;
  dias_sin_reportar: number | null;
  estado: string;
}

/**
 * DF5-B — «Pulso de obras» (PROMPT 128, F6b): un anillo por obra que late en
 * naranja mientras falta el parte del día y se cierra en verde al llegar.
 * Reusa `sgc.bitacoras_cobertura_resumen()` (BJ1b) vía el envoltorio
 * `sgc.pulso_obras_hoy()` — no duplica el cálculo de cobertura.
 */
@Component({
  selector: 'app-pulso-obras',
  templateUrl: './pulso-obras.html',
  styleUrl: './pulso-obras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class PulsoObrasComponent implements OnInit {
  private supabase = inject(SupabaseService);
  private user = inject(UserService);

  puedeVer = computed(() =>
    this.user.hasRole('admin') || this.user.hasModulo('proyectos') || this.user.hasModulo('direccion')
    || this.user.hasModulo('bitacora'));

  obras = signal<ObraPulso[]>([]);
  cargando = signal(true);
  error = signal('');

  async ngOnInit() {
    if (!this.puedeVer()) return;
    try {
      const { data, error } = await this.supabase.client.rpc('pulso_obras_hoy');
      if (error) throw new Error(error.message);
      this.obras.set((data ?? []) as ObraPulso[]);
    } catch {
      this.error.set('No se pudo cargar el pulso de obras.');
    } finally {
      this.cargando.set(false);
    }
  }
}
