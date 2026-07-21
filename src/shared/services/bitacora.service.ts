import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Bitacora, BitacoraArchivo, BitacoraFormData } from '../models/bitacora.model';

const SELECT_QUERY =
  '*, proyecto:proyectos(nombre, codigo), weather_snapshot:weather_snapshots(id, capturado_en, temperatura, sensacion, humedad, viento_kmh, precipitacion_mm, prob_precipitacion, uv, codigo_tiempo), actividades:bitacora_actividades(*), restricciones:bitacora_restricciones(*), archivos:bitacora_archivos(*), equipos:bitacora_equipos_alquilados(*)';

// W1: tope técnico ALTO (el modelo soporta N fotos; una fila por archivo). Espejo
// del parámetro sgc.parametros.bitacora_max_fotos = 40.
const MAX_ARCHIVOS = 40;
const MAX_TAMANO_BYTES = 50 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private supabase = inject(SupabaseService);

  /** RLS scopes this automatically: engineers get their own rows, staff with proyectos access get all. */
  async getAll(): Promise<Bitacora[]> {
    const { data, error } = await this.supabase.client
      .from('bitacoras')
      .select(SELECT_QUERY)
      .order('fecha', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Bitacora[];
  }

  async getById(id: string): Promise<Bitacora> {
    const { data, error } = await this.supabase.client
      .from('bitacoras')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Bitacora;
  }

  async create(payload: BitacoraFormData): Promise<Bitacora> {
    const { data: bitacoraId, error } = await this.supabase.client.rpc('crear_entrada_bitacora', {
      p_usuario_id: payload.usuario_id,
      p_proyecto_id: payload.proyecto_id,
      p_fecha: payload.fecha,
      p_tipo: payload.tipo,
      p_comentarios: payload.comentarios,
      p_bloque_entrepiso: payload.bloque_entrepiso,
      p_ingeniero_responsable: payload.ingeniero_responsable,
      p_hora_fin_trabajo: payload.hora_fin_trabajo,
      p_personal_carpinteria: payload.personal_carpinteria,
      p_personal_acero: payload.personal_acero,
      p_trabajadores_casa: payload.trabajadores_casa,
      p_otro_personal: payload.otro_personal,
      p_actividades: payload.actividades,
      p_restricciones: payload.restricciones,
      p_visita_tipo_visitante: payload.visita_tipo_visitante,
      p_visita_nombre: payload.visita_nombre,
      p_visita_organizacion: payload.visita_organizacion,
      p_visita_motivo: payload.visita_motivo,
      p_incidente_tipo: payload.incidente_tipo,
      p_incidente_gravedad: payload.incidente_gravedad,
      p_incidente_subcontratista: payload.incidente_subcontratista,
      p_incidente_lesionados: payload.incidente_lesionados,
      p_incidente_descripcion: payload.incidente_descripcion,
      p_incidente_acciones: payload.incidente_acciones,
      // Nuevos (Act.3 S12/S13): incidente de equipo + suceso. Retrocompatible.
      p_incidente_equipo_nombre: payload.incidente_equipo_nombre ?? null,
      p_incidente_equipo_alquilado: payload.incidente_equipo_alquilado ?? null,
      p_incidente_equipo_operativo: payload.incidente_equipo_operativo ?? null,
      p_incidente_suceso: payload.incidente_suceso ?? null,
      p_weather_snapshot_id: payload.weather_snapshot_id ?? null,
      // Nuevos (14/07): clima + migración (R21/R22). Retrocompatible (default null).
      p_llovio: payload.llovio ?? null,
      p_lluvia_detalle: payload.lluvia_detalle ?? null,
      p_hubo_migracion: payload.hubo_migracion ?? null,
      p_migracion_obreros: payload.migracion_obreros ?? null,
      // Nuevos (Act.4 W2): equipos alquilados. Retrocompatible (default en el RPC).
      p_hubo_equipos: payload.hubo_equipos ?? null,
      p_equipos_alquilados: payload.equipos_alquilados ?? [],
    });

    if (error) throw new Error(error.message);
    return this.getById(bitacoraId as string);
  }

  /**
   * Uploads a file to the private sgc-bitacora bucket and records it against the bitácora.
   * `url` stores the storage object path, not a public URL — the bucket is private, so
   * viewing/downloading later goes through `getSignedUrl()`.
   */
  async subirArchivo(bitacoraId: string, file: File): Promise<BitacoraArchivo> {
    if (file.size > MAX_TAMANO_BYTES) {
      throw new Error(`"${file.name}" excede el tamaño máximo de 50 MB.`);
    }

    const path = `${bitacoraId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await this.supabase.client.storage
      .from('sgc-bitacora')
      .upload(path, file);

    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await this.supabase.client
      .from('bitacora_archivos')
      .insert({
        bitacora_id: bitacoraId,
        nombre: file.name,
        url: path,
        tipo_mime: file.type || null,
        tamano_bytes: file.size,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as BitacoraArchivo;
  }

  /** Resolves a stored object path to a time-limited signed URL for viewing/downloading. */
  async getSignedUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage
      .from('sgc-bitacora')
      .createSignedUrl(path, 3600);

    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  get maxArchivos(): number {
    return MAX_ARCHIVOS;
  }

  /** W2 — nombres de equipos alquilados usados antes, para sugerir (datalist). */
  async getEquiposSugeridos(): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('bitacora_equipos_alquilados')
      .select('equipo')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return [];
    const vistos = new Set<string>();
    for (const r of (data ?? []) as { equipo: string }[]) {
      const e = (r.equipo ?? '').trim();
      if (e) vistos.add(e);
    }
    return [...vistos].slice(0, 50);
  }
}
