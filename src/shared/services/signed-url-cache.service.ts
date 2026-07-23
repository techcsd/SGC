import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** Transformación de Supabase Storage para pedir un thumbnail liviano. */
export interface ImgTransform {
  width?: number;
  height?: number;
  quality?: number;
}

interface Entry {
  url: string;
  /** epoch ms en que expira la URL firmada. */
  exp: number;
}

/**
 * W9 — cache GLOBAL de URLs firmadas de Storage.
 *
 * El problema: antes cada render llamaba `createSignedUrl(path, 3600)` → token
 * nuevo en cada carga → el browser NUNCA reutilizaba la imagen cacheada, y los
 * listados re-descargaban todo al reentrar.
 *
 * Solución: por `bucket+path(+transform)` se genera UNA sola URL con TTL largo
 * (24 h) y se reutiliza mientras no expire (memoria + sessionStorage). Como el
 * string de la URL es idéntico entre navegaciones, el browser sí cachea la
 * imagen (Network: "from cache", sin requests nuevas).
 *
 * Reemplaza a los ~19 métodos `getFotoUrl/getSignedUrl/signedUrl/…` que cada
 * servicio tenía por separado.
 */
@Injectable({ providedIn: 'root' })
export class SignedUrlCache {
  private supabase = inject(SupabaseService);

  /** Segundos de validez que se piden a Supabase (24 h). */
  private readonly TTL_SECONDS = 24 * 60 * 60;
  /** Margen de renovación: renueva ~5 min antes de expirar. */
  private readonly RENEW_MARGIN_MS = 5 * 60 * 1000;
  private readonly STORE_PREFIX = 'sgc.surl.';

  private mem = new Map<string, Entry>();

  private key(bucket: string, path: string, t?: ImgTransform): string {
    const tk = t ? `|w${t.width ?? ''}h${t.height ?? ''}q${t.quality ?? ''}` : '';
    return `${bucket}|${path}${tk}`;
  }

  private fresh(e: Entry | undefined): e is Entry {
    return !!e && e.exp - Date.now() > this.RENEW_MARGIN_MS;
  }

  private readStore(key: string): Entry | undefined {
    try {
      const raw = sessionStorage.getItem(this.STORE_PREFIX + key);
      return raw ? (JSON.parse(raw) as Entry) : undefined;
    } catch {
      return undefined;
    }
  }

  private writeStore(key: string, entry: Entry): void {
    try {
      sessionStorage.setItem(this.STORE_PREFIX + key, JSON.stringify(entry));
    } catch {
      /* sin storage (modo privado / cuota): queda solo en memoria */
    }
  }

  /**
   * URL firmada (cacheada) para un archivo. `transform` pide un thumbnail
   * (width/quality) — úsalo en listados; la original solo en el detalle.
   * Devuelve '' si el path es vacío/nulo o si la firma falla (nunca lanza).
   */
  async signed(bucket: string, path: string | null | undefined, transform?: ImgTransform): Promise<string> {
    if (!path) return '';
    const key = this.key(bucket, path, transform);
    const cached = this.mem.get(key) ?? this.readStore(key);
    if (this.fresh(cached)) {
      this.mem.set(key, cached);
      return cached.url;
    }
    try {
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .createSignedUrl(path, this.TTL_SECONDS, transform ? { transform } : undefined);
      if (error || !data?.signedUrl) return '';
      const entry: Entry = { url: data.signedUrl, exp: Date.now() + this.TTL_SECONDS * 1000 };
      this.mem.set(key, entry);
      this.writeStore(key, entry);
      return data.signedUrl;
    } catch {
      return '';
    }
  }

  /**
   * Firma en LOTE una lista de paths del mismo bucket (evita N round-trips al
   * pintar un listado). Reutiliza lo ya cacheado y solo pide los faltantes con
   * `createSignedUrls`. Devuelve un mapa path → url (sin transform; para
   * thumbnails con transform usar `signed` por ítem).
   */
  async signedMany(bucket: string, paths: (string | null | undefined)[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const misses: string[] = [];
    for (const p of paths) {
      if (!p) continue;
      const key = this.key(bucket, p);
      const cached = this.mem.get(key) ?? this.readStore(key);
      if (this.fresh(cached)) {
        this.mem.set(key, cached);
        out[p] = cached.url;
      } else if (!misses.includes(p)) {
        misses.push(p);
      }
    }
    if (misses.length === 0) return out;
    try {
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .createSignedUrls(misses, this.TTL_SECONDS);
      if (!error && data) {
        for (const row of data) {
          if (row.signedUrl && row.path) {
            const entry: Entry = { url: row.signedUrl, exp: Date.now() + this.TTL_SECONDS * 1000 };
            this.mem.set(this.key(bucket, row.path), entry);
            this.writeStore(this.key(bucket, row.path), entry);
            out[row.path] = row.signedUrl;
          }
        }
      }
    } catch {
      /* si el lote falla, out trae solo lo cacheado */
    }
    return out;
  }
}
