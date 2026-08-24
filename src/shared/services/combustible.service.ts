import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache } from './signed-url-cache.service';
import {
  RegistroCombustible,
  RegistroCombustibleFormData,
  CombustibleDerivados,
  PrecioCombustibleVigente,
  EchadaSospechosa,
} from '../models/combustible.model';
import { cleanUuid } from '../utils/uuid.util';

const BUCKET = 'vehiculos';

/** AF17 — fila del log de echadas (RPC log_combustible). */
export interface LogCombustibleRow {
  id: string;
  fecha: string;
  vehiculo_id: string | null;
  placa: string | null;
  kilometraje: number | null;
  km_anterior: number | null;
  km_recorridos: number | null;
  galones: number | null;
  monto: number | null;
  producto: string | null;
  subtipo: string | null;
  estado: string | null;
  km_alerta: boolean;
  alerta_consumo: boolean;
  registrado_por: string | null;
  registrado_nombre: string | null;
  conductor_nombre: string | null;
  es_prueba: boolean;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class CombustibleService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);

  async getAll(): Promise<RegistroCombustible[]> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .order('fecha', { ascending: false })
      .order('kilometraje', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RegistroCombustible[];
  }

  /** AG6 — registro completo de una echada (estación + 3 fotos) para el detalle del log. */
  async getById(id: string): Promise<RegistroCombustible | null> {
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre), registrador:usuarios!registrado_por(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as RegistroCombustible) ?? null;
  }

  /**
   * AF17 — Log de echadas para admin / roles elevados: quién registró, delta de
   * km vs echada anterior, saltos fuera de umbral. Vía RPC (server filtra por rol).
   */
  async getLog(filtros?: {
    desde?: string | null;
    hasta?: string | null;
    vehiculoId?: string | null;
    usuarioId?: string | null;
  }): Promise<LogCombustibleRow[]> {
    const { data, error } = await this.supabase.client.rpc('log_combustible', {
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
      p_vehiculo_id: filtros?.vehiculoId ?? null,
      p_usuario_id: filtros?.usuarioId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as LogCombustibleRow[];
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
    opts?: { confirmado?: boolean; clientUuid?: string },
  ): Promise<
    | { needsConfirm: true; message: string; clientUuid: string }
    | { needsConfirm?: false; registro: RegistroCombustible; derivados: CombustibleDerivados; clientUuid: string }
  > {
    // AW3 — el mismo client_uuid se reusa al confirmar (idempotente + reusa fotos).
    const clientUuid = opts?.clientUuid ?? crypto.randomUUID();

    // 1) Fotos primero: si fallan, no dejamos un registro sin evidencia.
    //    upsert por path del client_uuid → re-subir al confirmar es idempotente.
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
      // Z23.4 — producto/tarjeta/titular para conciliar con el reporte del proveedor.
      p_producto: payload.producto,
      p_tarjeta: payload.tarjeta,
      p_titular: payload.titular,
      p_titular_es_persona: payload.titular_es_persona,
      // AC11 — origen (estación | depósito en obra) + proyecto asociado. El
      // depósito de obra NO entra a conciliación de estación.
      p_origen: payload.origen ?? 'estacion',
      p_proyecto_id: cleanUuid(payload.proyecto_id),
      // AW3 — confirmación de valores inusuales (2º request tras el OK del usuario).
      p_confirmado: opts?.confirmado ?? false,
    });
    if (error) throw new Error(error.message);
    const derivados = data as unknown as CombustibleDerivados;

    // AW3 — el servidor pide confirmar un valor inusual: aún no insertó nada.
    if (derivados?.needs_confirm) {
      return {
        needsConfirm: true,
        message: derivados.confirm_message ?? '¿Confirmas la cantidad de galones?',
        clientUuid,
      };
    }

    // AA20 — subtipo (regular|premium) vía helper (no rompe la firma del RPC
    // compartido con la app). No bloquea el guardado si falla.
    if (payload.subtipo) {
      try {
        await this.supabase.client.rpc('set_echada_subtipo', {
          p_id: derivados.id,
          p_subtipo: payload.subtipo,
        });
      } catch { /* el subtipo es opcional; no romper el flujo */ }
    }

    // 3) El row completo (con joins) para la lista.
    const { data: row, error: rowErr } = await this.supabase.client
      .from('registros_combustible')
      .select('*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)')
      .eq('id', derivados.id)
      .single();
    if (rowErr) throw new Error(rowErr.message);

    return { registro: row as unknown as RegistroCombustible, derivados, clientUuid };
  }

  /** AW3 — echadas sospechosas para el panel de saneamiento (solo admin). */
  async echadasSospechosas(): Promise<EchadaSospechosa[]> {
    const { data, error } = await this.supabase.client.rpc('echadas_sospechosas');
    if (error) throw new Error(error.message);
    return (data ?? []) as EchadaSospechosa[];
  }

  /**
   * AW3 — sanea una echada (corregir | invalidar | revalidar), con traza. El
   * servidor conserva el valor original y recalcula promedios/estados (admin).
   */
  async sanearEchada(
    id: string,
    accion: 'corregir' | 'invalidar' | 'revalidar',
    campos?: { galones?: number | null; monto?: number | null; kilometraje?: number | null; motivo?: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('sanear_echada', {
      p_id: id,
      p_accion: accion,
      p_galones: campos?.galones ?? null,
      p_monto: campos?.monto ?? null,
      p_kilometraje: campos?.kilometraje ?? null,
      p_motivo: campos?.motivo ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** AA20 — precios oficiales vigentes (RD$/galón) por producto canónico. */
  async getPreciosVigentes(): Promise<PrecioCombustibleVigente[]> {
    const { data, error } = await this.supabase.client.rpc('precios_combustible_vigentes');
    if (error) return [];
    return (data ?? []) as PrecioCombustibleVigente[];
  }

  /**
   * Override MANUAL del precio vigente (admin/flota). Útil cuando el MICM publica
   * con rezago. Fija el precio con fecha de hoy → pasa a ser el vigente.
   */
  async setPrecio(producto: string, precio: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_precio_combustible', {
      p_producto: producto,
      p_precio: precio,
    });
    if (error) throw new Error(error.message);
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
    return this.cache.signed(BUCKET, path);
  }
}
