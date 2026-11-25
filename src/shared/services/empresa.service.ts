import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';

/** EA4 — límites del bucket `sgc-avatars` (sql/2026-07-07-perfil-avatar.sql): png/jpeg/webp, 5 MB. */
export const LOGO_MIME_PERMITIDOS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_ERROR_FORMATO = 'Usa PNG, JPG o WebP de hasta 5 MB.';

/** EA4 — valida el logo ANTES de subirlo; devuelve el mensaje en español o null si es válido. */
export function validarLogo(file: { type: string; size: number }): string | null {
  if (!(LOGO_MIME_PERMITIDOS as readonly string[]).includes(file.type)) return LOGO_ERROR_FORMATO;
  if (file.size > LOGO_MAX_BYTES) return LOGO_ERROR_FORMATO;
  return null;
}

/** AG13 — datos generales de la empresa (fila única). */
export interface Empresa {
  id: number;
  razon_social: string | null;
  nombre_comercial: string | null;
  rnc: string | null;
  representante: string | null; // AZ1 — representante legal (fuente de {{representante_empresa}})
  gerente_general: string | null; // CF7 — gerente general (contrato)
  testigos_frecuentes?: TestigoFrecuente[]; // CF7 — testigos frecuentes (jsonb)
  direccion: string | null;
  ciudad: string | null;
  pais: string | null;
  telefono: string | null;
  email: string | null;
  sitio_web: string | null;
  logo_path: string | null;
  updated_at: string;
}

export interface TestigoFrecuente { nombre: string; cedula: string; }

export type EmpresaPatch = Partial<Omit<Empresa, 'id' | 'updated_at'>>;

@Injectable({ providedIn: 'root' })
export class EmpresaService {
  private supabase = inject(SupabaseService);

  async get(): Promise<Empresa | null> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('empresa')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as Empresa) ?? null;
  }

  async update(patch: EmpresaPatch): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('empresa')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error(error.message);
  }

  /** DH10 — logo de la empresa: bucket público `sgc-avatars`, carpeta `empresa/`
   *  (política de storage solo-admin, no es un dato de un usuario). */
  async subirLogo(file: File): Promise<string> {
    const invalido = validarLogo(file);
    if (invalido) throw new Error(invalido);
    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
    // EA4 — upsert:false: el nombre ya es único (timestamp); con upsert:true Storage hace
    // INSERT…ON CONFLICT DO UPDATE y exige poder LEER la fila (política select).
    const path = `empresa/logo-${Date.now()}.${ext}`;
    const { error } = await this.supabase.client.storage
      .from('sgc-avatars')
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      const m = (error.message ?? '').toLowerCase();
      throw new Error(
        m.includes('row-level security') || m.includes('unauthorized') || m.includes('403')
          ? 'Solo un administrador puede cambiar el logo de la empresa.'
          : error.message,
      );
    }
    await this.update({ logo_path: path });
    return path;
  }

  logoUrl(path: string | null): string | null {
    if (!path) return null;
    return this.supabase.client.storage.from('sgc-avatars').getPublicUrl(path).data.publicUrl;
  }

  /** CF7 — guarda la configuración legal (empresa + testigos) vía RPC definer (legal/admin). */
  async guardarConfigLegal(cfg: {
    razon_social?: string | null;
    rnc?: string | null;
    direccion?: string | null;
    ciudad?: string | null;
    representante?: string | null;
    gerente_general?: string | null;
    testigos?: TestigoFrecuente[];
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_config_legal', {
      p_razon_social: cfg.razon_social ?? null,
      p_rnc: cfg.rnc ?? null,
      p_direccion: cfg.direccion ?? null,
      p_ciudad: cfg.ciudad ?? null,
      p_representante: cfg.representante ?? null,
      p_gerente_general: cfg.gerente_general ?? null,
      p_testigos: cfg.testigos ?? null,
    });
    if (error) throw new Error(error.message);
  }
}
