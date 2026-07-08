import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import QRCode from 'qrcode';
import { SupabaseService } from '../../core/services/supabase.service';

interface VersionInfo {
  versionName: string;
  changelog: string;
  url: string;
  released_at: string;
  size_bytes: number;
}

const PWA_URL = 'https://app.sgcconstructorasd.com';
const VERSION_URL =
  'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/version.json';

/**
 * Internal distribution page for the CSD field app: Android APK (direct
 * install, link + QR) and the installable PWA for iPhone. Reads the published
 * version.json so it always reflects the latest release.
 */
@Component({
  selector: 'app-app-movil',
  imports: [DecimalPipe],
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

  async ngOnInit() {
    this.pwaQr.set(await QRCode.toDataURL(PWA_URL, { width: 220, margin: 1 }));
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
