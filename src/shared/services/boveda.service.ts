import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { BovedaEntrada, BovedaAcceso, BovedaTipo } from '../models/boveda.model';

export interface BovedaRevelado {
  valor: string;
  visible_segundos: number;
}

/** CZ3/CZ9 — cliente de la edge `boveda`. Nunca persiste el valor en claro más
 *  allá de la memoria del componente que lo pidió (el que lo oculta a los 30 s). */
@Injectable({ providedIn: 'root' })
export class BovedaService {
  private supabase = inject(SupabaseService);

  private async invocar<T = unknown>(accion: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.supabase.client.functions.invoke('boveda', { body: { accion, ...payload } });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed && typeof parsed === 'object' && 'error' in parsed) throw new Error(String((parsed as { error: unknown }).error));
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
        }
      }
      throw new Error(error.message);
    }
    const d = data as { ok: boolean; error?: string };
    if (!d.ok) throw new Error(d.error ?? 'No se pudo completar la operación.');
    return data as T;
  }

  // ── Metadata (lista/detalle, sin pasar por la edge — no es secreta) ───────
  async listar(): Promise<BovedaEntrada[]> {
    const { data, error } = await this.supabase.client
      .from('boveda_entradas')
      .select('id, tipo, nombre, sitio_url, usuario_texto, archivo_path, archivo_nombre, archivo_mime, etiquetas, rotar_cada_dias, ultima_rotacion, notas, creado_por, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BovedaEntrada[];
  }

  async listarAccesos(entradaId?: string): Promise<BovedaAcceso[]> {
    let q = this.supabase.client.from('boveda_accesos').select('*').order('created_at', { ascending: false }).limit(200);
    if (entradaId) q = q.eq('entrada_id', entradaId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BovedaAcceso[];
  }

  async sesionVigenteHasta(): Promise<Date | null> {
    const { data, error } = await this.supabase.client.rpc('boveda_sesion_vigente');
    if (error || !data) return null;
    return new Date(data as string);
  }

  // ── Edge (reautenticación + cifrado) ───────────────────────────────────────
  async abrirSesion(password: string): Promise<{ expira_at: string }> {
    return this.invocar('sesion_abrir', { password });
  }

  async crear(payload: {
    tipo: BovedaTipo; nombre: string; sitio_url?: string | null; usuario_texto?: string | null;
    valor?: string | null; etiquetas?: string[]; rotar_cada_dias?: number | null; notas?: string | null;
  }): Promise<{ id: string }> {
    return this.invocar('crear', payload);
  }

  async editar(entradaId: string, payload: {
    nombre?: string; sitio_url?: string | null; usuario_texto?: string | null; valor?: string | null;
    etiquetas?: string[]; rotar_cada_dias?: number | null; ultima_rotacion?: string | null; notas?: string | null;
  }): Promise<void> {
    await this.invocar('editar', { entrada_id: entradaId, ...payload });
  }

  async eliminar(entradaId: string): Promise<void> {
    await this.invocar('eliminar', { entrada_id: entradaId });
  }

  async revelar(entradaId: string): Promise<BovedaRevelado> {
    return this.invocar('revelar', { entrada_id: entradaId });
  }
  async mostrarSemilla(entradaId: string): Promise<BovedaRevelado> {
    return this.invocar('mostrar_semilla', { entrada_id: entradaId });
  }
  async codigo2fa(entradaId: string): Promise<{ codigo: string; segundos_restantes: number }> {
    return this.invocar('codigo_2fa', { entrada_id: entradaId });
  }
  async registrarCopia(entradaId: string): Promise<void> {
    await this.invocar('copiar_evento', { entrada_id: entradaId });
  }

  async subirArchivo(payload: { nombre: string; archivo_nombre: string; mime: string; contenido_base64: string; etiquetas?: string[]; notas?: string | null }): Promise<{ id: string }> {
    return this.invocar('archivo_subir', payload);
  }
  async descargarArchivo(entradaId: string): Promise<{ contenido_base64: string; archivo_nombre: string; visible_segundos: number }> {
    return this.invocar('archivo_descargar', { entrada_id: entradaId });
  }
}
