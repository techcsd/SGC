import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  RegistroCombustible,
  RegistroCombustibleFormData,
  CombustibleDerivados,
} from '../models/combustible.model';
import { cleanUuid } from '../utils/uuid.util';

const BUCKET = 'vehiculos';

@Injectable({ providedIn: 'root' })
export class CombustibleService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<RegistroCombustible[]> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .order('fecha', { ascending: false })
      .order('kilometraje', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RegistroCombustible[];
  }

  /**
   * Registra una echada v2 vía RPC (idempotente por client_uuid). Sube las 2
   * fotos obligatorias al bucket `vehiculos` (combustible/{uuid}/…) y devuelve
   * los derivados calculados en servidor + el registro ya persistido.
   */
  async registrar(
    payload: RegistroCombustibleFormData,
    recibo: File,
    tablero: File,
  ): Promise<{ registro: RegistroCombustible; derivados: CombustibleDerivados }> {
    const clientUuid = crypto.randomUUID();

    // 1) Fotos primero: si fallan, no dejamos un registro sin evidencia.
    const [reciboPath, tableroPath] = await Promise.all([
      this.uploadFoto(clientUuid, 'recibo', recibo),
      this.uploadFoto(clientUuid, 'tablero', tablero),
    ]);

    // 2) RPC: calcula precio/galón, km recorridos, rendimiento, costo/km y alerta.
    const { data, error } = await this.supabase.client.rpc('registrar_combustible_app', {
      p_client_uuid: clientUuid,
      p_vehiculo_id: cleanUuid(payload.vehiculo_id),
      p_conductor_id: cleanUuid(payload.conductor_id), // C2 — "null" de <select> → null
      p_fecha: payload.fecha,
      p_kilometraje: payload.kilometraje,
      p_galones: payload.galones,
      p_monto: payload.monto,
      p_estacion: payload.estacion,
      p_foto_recibo_path: reciboPath,
      p_foto_tablero_path: tableroPath,
      p_notas: payload.notas,
    });
    if (error) throw new Error(error.message);
    const derivados = data as unknown as CombustibleDerivados;

    // 3) El row completo (con joins) para la lista.
    const { data: row, error: rowErr } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .eq('id', derivados.id)
      .single();
    if (rowErr) throw new Error(rowErr.message);

    return { registro: row as unknown as RegistroCombustible, derivados };
  }

  /** Sube una foto (recibo|tablero) y devuelve su storage path. */
  private async uploadFoto(clientUuid: string, slot: string, file: File): Promise<string> {
    const path = `combustible/${clientUuid}/${slot}.jpg`;
    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(`No se pudo subir la foto (${slot}): ${error.message}`);
    return path;
  }

  /** Email (no bloqueante) a Flota cuando se detecta consumo anormal. */
  async notificarConsumoAnormal(r: RegistroCombustible): Promise<void> {
    try {
      await this.supabase.client.functions.invoke('notificar-flota', {
        body: {
          tipo: 'consumo_anormal',
          titulo: 'Consumo anormal de combustible',
          detalleHtml: `<p>Rendimiento registrado: <strong>${r.rendimiento_km_gal} km/gal</strong>. Posible fuga, problema mecánico o combustible desviado.</p>`,
          vehiculo: r.vehiculo?.placa,
          conductor: r.conductor?.nombre,
        },
      });
    } catch {
      /* el email nunca bloquea el flujo */
    }
  }

  /** Resuelve un storage path a una URL firmada temporal (null si falla). */
  async getFotoUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }
}
