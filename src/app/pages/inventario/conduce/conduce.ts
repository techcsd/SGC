import { Component, ChangeDetectionStrategy, computed, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { SupabaseService } from '../../../../app/core/services/supabase.service';
import {
  SalidaInventario,
  SALIDA_ESTADO_LABELS,
  MOTIVOS_SALIDA,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { formatFechaDisplay, formatTimestampDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

@Component({
  selector: 'app-conduce',
  imports: [Skeleton],
  templateUrl: './conduce.html',
  styleUrl: './conduce.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduce implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private salidasService = inject(SalidasService);
  private supabase = inject(SupabaseService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  readonly hoy = todayIso();
  readonly numeroConduce: string;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  salida = signal<SalidaInventario | null>(null);
  // La columna Talla solo se muestra si algún renglón la tiene (EPP) — así el
  // conduce de materiales normales queda limpio.
  mostrarTalla = computed(() => (this.salida()?.detalle_salidas ?? []).some((d) => !!d.talla));
  loading = signal(true);
  error = signal('');
  // Delivery evidence (photo + receiver signature) captured by the mobile app.
  entregaFotoUrl = signal<string | null>(null);
  entregaFirmaUrl = signal<string | null>(null);
  // Evidence photo taken when the salida itself was captured in the field.
  salidaFotoUrl = signal<string | null>(null);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.numeroConduce = conduceNumero(id);
  }

  motivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Salida no especificada.');
      this.loading.set(false);
      return;
    }
    try {
      const s = await this.salidasService.getById(id);
      this.salida.set(s);
      await this.loadEvidencia(s);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la salida.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve the private storage paths to time-limited signed URLs. Delivery
   *  evidence lives in the `conduces` bucket; the salida capture photo in
   *  `inventario`. */
  private async loadEvidencia(s: SalidaInventario) {
    const sign = async (bucket: string, path: string | null): Promise<string | null> => {
      if (!path) return null;
      const { data } = await this.supabase.client.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    };
    this.entregaFotoUrl.set(await sign('conduces', s.entrega_foto_path));
    this.entregaFirmaUrl.set(await sign('conduces', s.entrega_firma_path));
    this.salidaFotoUrl.set(await sign('inventario', s.foto_path));
  }

  imprimir() {
    window.print();
  }

  /** Go back to wherever the user came from (Salidas, the Conduces list, or the
   *  engineer's Entregas page). Falls back to the dashboard on a direct hit. */
  volver() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
