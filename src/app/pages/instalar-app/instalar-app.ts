import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import QRCode from 'qrcode';
import { SupabaseService } from '../../core/services/supabase.service';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';

interface Tienda { clave: 'play' | 'appstore'; nombre: string; url: string; qr: string | null }

/** DX6 — «Instalar la app» (pública, sin login): botones/QR a las fichas de tienda configuradas en Parámetros
 *  (tienda_play_url / tienda_appstore_url, vacías hasta que existan las cuentas) y a la PWA. */
@Component({
  selector: 'app-instalar-app',
  imports: [TranslatePipe],
  templateUrl: './instalar-app.html',
  styleUrl: './instalar-app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstalarApp implements OnInit {
  private supabase = inject(SupabaseService);
  tiendas = signal<Tienda[]>([]);
  cargado = signal(false);
  readonly pwaUrl = 'https://app.sgcconstructorasd.com';

  async ngOnInit() {
    try {
      const { data } = await this.supabase.client.rpc('tiendas_publicas');
      const d = (data ?? {}) as { play?: string | null; appstore?: string | null };
      const lista: Tienda[] = [];
      if (d.play) lista.push({ clave: 'play', nombre: 'Google Play', url: d.play, qr: null });
      if (d.appstore) lista.push({ clave: 'appstore', nombre: 'App Store', url: d.appstore, qr: null });
      for (const t of lista) t.qr = await QRCode.toDataURL(t.url, { width: 180, margin: 1 }).catch(() => null);
      this.tiendas.set(lista);
    } catch { /* sin tiendas configuradas: se muestra solo la PWA */ }
    this.cargado.set(true);
  }
}
