import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ErrorState } from '../../../../shared/ui/error-state/error-state';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { formatFechaRelativa } from '../../../../shared/utils/fecha.util';

interface Escaneo { id: string; tipo: string; doc_id: string; resultado: string; creado_en: string; usuario: { nombre: string } | null }

const TIPO_LABEL: Record<string, string> = { conduce: 'Conduce', requisicion: 'Requisición', solicitud_compra: 'Solicitud de compra' };

/** DX7 (AT11) — quién escaneó el QR de qué documento y cuándo (últimos 100). Solo administración/tecnología (RLS). */
@Component({
  selector: 'app-admin-escaneos-qr',
  imports: [ErrorState, TranslatePipe],
  templateUrl: './escaneos-qr.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminEscaneosQr implements OnInit {
  private supabase = inject(SupabaseService);
  filas = signal<Escaneo[]>([]);
  loading = signal(true);
  error = signal<unknown>(null);
  tipoLabel = (t: string) => TIPO_LABEL[t] ?? t;
  relativo = (iso: string) => formatFechaRelativa(iso);

  async ngOnInit() { await this.cargar(); }

  async cargar() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { data, error } = await this.supabase.client
        .from('doc_qr_escaneos')
        .select('id, tipo, doc_id, resultado, creado_en, usuario:usuarios(nombre)')
        .order('creado_en', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      this.filas.set((data ?? []) as unknown as Escaneo[]);
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
