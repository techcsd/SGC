import { Injectable, inject } from '@angular/core';
import QRCode from 'qrcode';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';
import { UiFlagsService } from './ui-flags.service';

/** DS-34/#74 + DX7 — QR por tipo de documento (token HMAC con vencimiento emitido por la edge `conduce-qr`). */
export type TipoDocQr = 'conduce' | 'requisicion' | 'solicitud_compra';

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

  /** DX7 — QR de cualquier documento soportado. `null` si el interruptor del tipo está apagado, no hay acceso o falla
   *  (el QR es un extra: nunca rompe la pantalla). Destino único `/d/:token`. */
  async qrDocDataUrl(tipo: Exclude<TipoDocQr, 'conduce'>, id: string): Promise<string | null> {
    try {
      const r = await invokeEdge<{ token: string }>(this.supabase.client, 'conduce-qr', { accion: 'emitir', tipo, id });
      return await QRCode.toDataURL(`${window.location.origin}/d/${encodeURIComponent(r.token)}`, { width: 220, margin: 1 });
    } catch {
      return null;
    }
  }

  /** Resuelve el token escaneado a {tipo, id, ruta}; lanza con un mensaje legible si es inválido/vencido. */
  async resolver(token: string): Promise<{ tipo: TipoDocQr; id: string; ruta: string; salidaId?: string; estado: string }> {
    return invokeEdge(this.supabase.client, 'conduce-qr', { accion: 'resolver', token });
  }
}
