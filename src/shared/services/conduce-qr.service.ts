import { Injectable, inject } from '@angular/core';
import QRCode from 'qrcode';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';
import { UiFlagsService } from './ui-flags.service';

/** DS-34/#74 — QR del conduce (token HMAC con vencimiento emitido por la edge `conduce-qr`). */
@Injectable({ providedIn: 'root' })
export class ConduceQrService {
  private supabase = inject(SupabaseService);
  private flags = inject(UiFlagsService);

  /** URL de recepción que codifica el QR (mismo origen que la app: nunca localhost hardcodeado). */
  private urlDeRecepcion(token: string): string {
    return `${window.location.origin}/conduce-qr/${encodeURIComponent(token)}`;
  }

  /** Data-URL del QR del conduce, o null si el flag está apagado / no hay acceso / falla (el QR es un extra). */
  async qrDataUrl(salidaId: string): Promise<string | null> {
    await this.flags.cargar();
    if (!this.flags.conduceQrActivo()) return null;
    try {
      const r = await invokeEdge<{ token: string }>(this.supabase.client, 'conduce-qr', { accion: 'emitir', salidaId });
      return await QRCode.toDataURL(this.urlDeRecepcion(r.token), { width: 220, margin: 1 });
    } catch {
      return null;
    }
  }

  /** Resuelve el token escaneado a {salidaId, estado}; lanza con un mensaje legible si es inválido/vencido. */
  async resolver(token: string): Promise<{ salidaId: string; estado: string }> {
    return invokeEdge<{ salidaId: string; estado: string }>(this.supabase.client, 'conduce-qr', { accion: 'resolver', token });
  }
}
