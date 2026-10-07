import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import QRCode from 'qrcode';
import { SupabaseService } from '../../core/services/supabase.service';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../shared/ui/icon/icon';
import { environment } from '../../../environments/environment';

interface VersionInfo {
  versionName: string;
  changelog: string;
  url: string;
  released_at: string;
  size_bytes: number;
}

const PWA_URL = 'https://app.sgcconstructorasd.com';
// El APK publicado (version.json) vive en el bucket público app-releases. Se toma
// el host del entorno (no hardcodear el ref de prod — guard verify-sin-ref-hardcodeado).
const VERSION_URL = `${environment.supabaseUrl}/storage/v1/object/public/app-releases/version.json`;

/**
 * Internal distribution page for the CSD field app: Android APK (direct
 * install, link + QR) and the installable PWA for iPhone. Reads the published
 * version.json so it always reflects the latest release.
 */
@Component({
  selector: 'app-app-movil',
  imports: [DecimalPipe, Skeleton, Icon],
  templateUrl: './app-movil.html',
  styleUrl: './app-movil.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppMovil implements OnInit {
  private supabase = inject(SupabaseService);

  info = signal<VersionInfo | null>(null);
  apkQr = signal<string>('');
  pwaQr = signal<string>('');
  loading = signal(true);
  readonly pwaUrl = PWA_URL;

  // CI1/CI7 — fichas oficiales de tienda (null hasta que existan).
  playStoreUrl = signal<string | null>(null);
  appStoreUrl = signal<string | null>(null);
  playQr = signal<string>('');
  appStoreQr = signal<string>('');

  async ngOnInit() {
    this.pwaQr.set(await QRCode.toDataURL(PWA_URL, { width: 220, margin: 1 }));
    // CI1 — lee las URLs de tienda (la página está detrás de authGuard → lectura autenticada).
    try {
      const { data } = await this.supabase.client
        .from('parametros').select('clave,valor').in('clave', ['play_store_url', 'app_store_url']);
      for (const row of (data ?? []) as { clave: string; valor: string }[]) {
        const v = (row.valor ?? '').trim();
        if (!v) continue;
        if (row.clave === 'play_store_url') { this.playStoreUrl.set(v); this.playQr.set(await QRCode.toDataURL(v, { width: 220, margin: 1 })); }
        if (row.clave === 'app_store_url') { this.appStoreUrl.set(v); this.appStoreQr.set(await QRCode.toDataURL(v, { width: 220, margin: 1 })); }
      }
    } catch {
      /* sin conexión / sin permiso → sin insignias, el resto funciona */
    }
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' });
      if (res.ok) {
        const info = (await res.json()) as VersionInfo;
        this.info.set(info);
        this.apkQr.set(await QRCode.toDataURL(info.url, { width: 220, margin: 1 }));
      }
    } catch {
      /* offline / not published yet — the PWA option still works */
    } finally {
      this.loading.set(false);
    }
  }

  get sizeMb(): number {
    return (this.info()?.size_bytes ?? 0) / (1024 * 1024);
  }
}
