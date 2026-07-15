import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { environment } from '../../environments/environment';
import { AppVersion, AppVersionFormData, VersionPublicada } from '../models/app-version.model';

const APK_BUCKET = 'app-releases';

/** Versionado por etapas de la app móvil (R15). Escritura sólo admin (RLS). */
@Injectable({ providedIn: 'root' })
export class AppVersionesService {
  private supabase = inject(SupabaseService);

  /** Versiones de la app móvil (para la gestión de rollout — solo 'movil'). */
  async getAll(): Promise<AppVersion[]> {
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .select('*')
      .eq('plataforma', 'movil')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AppVersion[];
  }

  /** Historial/timeline completo (ambas plataformas), más reciente primero. */
  async getHistorial(): Promise<AppVersion[]> {
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .select('*')
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AppVersion[];
  }

  async create(payload: AppVersionFormData): Promise<AppVersion> {
    // La gestión de rollout es solo de la app móvil.
    const row: Record<string, unknown> = { ...payload, plataforma: 'movil' };
    if (payload.publicada) row['publicada_at'] = new Date().toISOString();
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as AppVersion;
  }

  async update(id: string, payload: Partial<AppVersionFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Publica/despublica una versión (sella publicada_at al publicar). */
  async setPublicada(id: string, publicada: boolean): Promise<void> {
    const patch: Record<string, unknown> = { publicada };
    if (publicada) patch['publicada_at'] = new Date().toISOString();
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async setMinima(id: string, minima: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('app_versiones')
      .update({ minima })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('app_versiones').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** RPC público: versión publicada + mínima (para la app móvil / About). */
  async versionPublicada(): Promise<VersionPublicada> {
    const { data, error } = await this.supabase.client.rpc('version_publicada');
    if (error) throw new Error(error.message);
    return (data ?? {}) as VersionPublicada;
  }

  /**
   * V3 — Sube un APK al bucket público `app-releases` con progreso real (XHR).
   * Guarda el objeto como `csd-app-<version>.apk` y devuelve su URL pública.
   * Usamos XHR (no supabase-js) porque necesitamos onprogress para la barra.
   */
  async uploadApk(
    file: File,
    version: string,
    onProgress?: (pct: number) => void,
  ): Promise<string> {
    const safeVersion = version.replace(/[^0-9A-Za-z.\-_]/g, '_') || 'sin-version';
    const path = `csd-app-${safeVersion}.apk`;

    const { data: sessionData } = await this.supabase.client.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Sesión no disponible. Vuelve a iniciar sesión.');

    const url = `${environment.supabaseUrl}/storage/v1/object/${APK_BUCKET}/${path}`;

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', environment.supabaseAnonKey);
      // Reemplaza si ya existe una versión con ese nombre.
      xhr.setRequestHeader('x-upsert', 'true');
      // Cache corto: si se re-sube una build corregida de la misma versión, no
      // queremos servir la copia vieja por mucho tiempo.
      xhr.setRequestHeader('cache-control', '60');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Error al subir (${xhr.status}): ${xhr.responseText}`));
      };
      xhr.onerror = () => reject(new Error('Error de red al subir el APK.'));
      const fd = new FormData();
      fd.append('file', file, path);
      xhr.send(fd);
    });

    const { data } = this.supabase.client.storage.from(APK_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * V4 — Notifica a TODOS los usuarios que hay una versión nueva: aviso in-app
   * (RPC notificar_todos) + correo (edge function notificar-version).
   * Fire-and-forget en el correo: un fallo de email nunca bloquea la publicación.
   */
  async notificarPublicacion(version: string, notas: string | null, apkUrl: string | null): Promise<void> {
    // 1) Centro de notificaciones in-app (todos los usuarios activos).
    const { error } = await this.supabase.client.rpc('notificar_todos', {
      p_tipo: 'info',
      p_titulo: `Nueva versión ${version} disponible`,
      // Sin ruta: el aviso es informativo y va a TODOS los usuarios (la página de
      // versiones es solo-admin; enlazarla sería un callejón para el resto).
      p_mensaje: 'Ya puedes actualizar la app CSD desde la app: Ajustes → Buscar actualización.',
      p_ruta: null,
    });
    if (error) throw new Error(error.message);

    // 2) Correo a todos (no bloqueante).
    this.supabase.client.functions
      .invoke('notificar-version', { body: { version, notas, apkUrl } })
      .catch((e) => console.error('notificar-version email failed', e));
  }
}
