import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { UserService } from '../../core/services/user.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

interface EtapaFlujo {
  etapa: string;
  cantidad: number;
  promedio_horas: number | null;
  es_cuello_botella: boolean;
}

interface DetalleFlujo {
  referencia: string;
  obra: string;
  horas: number;
  en_fecha: string;
}

const ETIQUETAS: Record<string, string> = {
  solicitud_a_aprobacion: 'Solicitud → aprobación',
  despacho_a_transito: 'Despacho → en ruta',
  transito_a_entrega: 'En ruta → entrega',
};

/**
 * DF5-A — «Requisición → recepción» (PROMPT 128, F6b): tiempo promedio real
 * entre los timestamps que ya registra el sistema (sgc.requisicion_flujo_tiempos,
 * mismos campos que usa sgc.tablero_vivo_resumen) y resalta el tramo más lento.
 * Tocar una etapa abre la lista exacta detrás del número (AT11).
 *
 * Limitación conocida (documentada, no se inventó dato): no se mide
 * "aprobada → despachada" porque no hay una FK verificada que enlace
 * solicitudes_material con salidas_inventario en este repo.
 */
@Component({
  selector: 'app-flujo-requisicion',
  templateUrl: './flujo-requisicion.html',
  styleUrl: './flujo-requisicion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, TranslatePipe],
})
export class FlujoRequisicionComponent implements OnInit {
  private supabase = inject(SupabaseService);
  private user = inject(UserService);

  puedeVer = computed(() =>
    this.user.hasRole('admin') || this.user.hasModulo('inventario') || this.user.hasModulo('compras')
    || this.user.hasModulo('proyectos'));

  etapas = signal<EtapaFlujo[]>([]);
  cargando = signal(true);
  error = signal('');

  etapaAbierta = signal<string | null>(null);
  detalle = signal<DetalleFlujo[]>([]);
  cargandoDetalle = signal(false);

  etiqueta(etapa: string): string {
    return ETIQUETAS[etapa] ?? etapa;
  }

  async ngOnInit() {
    if (!this.puedeVer()) return;
    try {
      const { data, error } = await this.supabase.client.rpc('requisicion_flujo_tiempos', { p_dias: 30 });
      if (error) throw new Error(error.message);
      this.etapas.set((data ?? []) as EtapaFlujo[]);
    } catch {
      this.error.set('No se pudo cargar el flujo de requisiciones.');
    } finally {
      this.cargando.set(false);
    }
  }

  async toggleEtapa(etapa: string) {
    if (this.etapaAbierta() === etapa) {
      this.etapaAbierta.set(null);
      return;
    }
    this.etapaAbierta.set(etapa);
    this.cargandoDetalle.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('requisicion_flujo_detalle', {
        p_etapa: etapa,
        p_dias: 30,
      });
      if (error) throw new Error(error.message);
      this.detalle.set((data ?? []) as DetalleFlujo[]);
    } catch {
      this.detalle.set([]);
    } finally {
      this.cargandoDetalle.set(false);
    }
  }
}
