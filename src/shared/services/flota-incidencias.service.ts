import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  VehiculoAccidente,
  VehiculoDano,
  ConductorMulta,
  AccidenteFormData,
  DanoFormData,
  MultaFormData,
} from '../models/flota-incidencias.model';

const BUCKET = 'flota-documentos';
const ACC_SELECT = '*, vehiculo:vehiculos(placa, marca, modelo), conductor:conductores(nombre)';
const MULTA_SELECT = '*, vehiculo:vehiculos(placa), conductor:conductores(nombre)';

/**
 * S22/S24 — Accidentes, daños y multas de flota (web). RLS scopea las filas:
 * elevados ven todo; el chofer ve las suyas. Los documentos (acta AMET, multa)
 * y fotos de daño van al bucket flota-documentos (se guarda el path).
 */
@Injectable({ providedIn: 'root' })
export class FlotaIncidenciasService {
  private supabase = inject(SupabaseService);

  // ── Accidentes ─────────────────────────────────────────────
  async accidentesPorVehiculo(vehiculoId: string): Promise<VehiculoAccidente[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_accidentes')
      .select(ACC_SELECT)
      .eq('vehiculo_id', vehiculoId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAccidente[];
  }

  async accidentesPorConductor(conductorId: string): Promise<VehiculoAccidente[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_accidentes')
      .select(ACC_SELECT)
      .eq('conductor_id', conductorId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAccidente[];
  }

  async accidentesTodos(): Promise<VehiculoAccidente[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_accidentes')
      .select(ACC_SELECT)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoAccidente[];
  }

  async accidenteById(id: string): Promise<VehiculoAccidente> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_accidentes')
      .select(ACC_SELECT)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as VehiculoAccidente;
  }

  /**
   * T12 — usa la MISMA vía de escritura que la app móvil: el RPC
   * `registrar_accidente_app` (idempotente, SECURITY DEFINER, valida módulo Flota
   * y fija creado_por = auth.uid()). Subimos el acta AMET al bucket y pasamos su
   * path al RPC. Devolvemos la fila completa releyéndola por id.
   */
  async crearAccidente(
    payload: AccidenteFormData,
    _userId: string,
    ametFile?: File | null,
  ): Promise<VehiculoAccidente> {
    let ametPath: string | null = null;
    if (ametFile) ametPath = await this.upload('accidentes', ametFile);
    const id = crypto.randomUUID();
    const { error } = await this.supabase.client.rpc('registrar_accidente_app', {
      p_id: id,
      p_vehiculo_id: payload.vehiculo_id,
      p_fecha: payload.fecha,
      p_fase: payload.fase,
      p_descripcion: payload.descripcion,
      p_lesionados: payload.lesionados,
      p_tercero: payload.tercero_involucrado,
      p_conductor_id: payload.conductor_id,
      p_gps: null,
      p_reporte_amet_path: ametPath,
    });
    if (error) throw new Error(error.message);
    return this.accidenteById(id);
  }

  // ── Daños ──────────────────────────────────────────────────
  async danosPorVehiculo(vehiculoId: string): Promise<VehiculoDano[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_danos')
      .select('*')
      .eq('vehiculo_id', vehiculoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as VehiculoDano[];
  }

  async crearDano(payload: DanoFormData, userId: string, fotoFile?: File | null): Promise<VehiculoDano> {
    let fotoPath: string | null = null;
    if (fotoFile) fotoPath = await this.upload('danos', fotoFile);
    const { data, error } = await this.supabase.client
      .from('vehiculo_danos')
      .insert({ ...payload, foto_path: fotoPath, reportado_por: userId })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as VehiculoDano;
  }

  // ── Multas ─────────────────────────────────────────────────
  async multasPorConductor(conductorId: string): Promise<ConductorMulta[]> {
    const { data, error } = await this.supabase.client
      .from('conductor_multas')
      .select(MULTA_SELECT)
      .eq('conductor_id', conductorId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConductorMulta[];
  }

  // U11-web — multas relacionadas al vehículo (perfil del vehículo). RLS scopea.
  async multasPorVehiculo(vehiculoId: string): Promise<ConductorMulta[]> {
    const { data, error } = await this.supabase.client
      .from('conductor_multas')
      .select(MULTA_SELECT)
      .eq('vehiculo_id', vehiculoId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConductorMulta[];
  }

  async crearMulta(payload: MultaFormData, userId: string, docFile?: File | null): Promise<ConductorMulta> {
    let docPath: string | null = null;
    if (docFile) docPath = await this.upload('multas', docFile);
    const { data, error } = await this.supabase.client
      .from('conductor_multas')
      .insert({ ...payload, documento_path: docPath, registrado_por: userId })
      .select(MULTA_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as ConductorMulta;
  }

  async marcarMultaPagada(id: string, pagada: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductor_multas')
      .update({ estado: pagada ? 'pagada' : 'pendiente' })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Storage ────────────────────────────────────────────────
  private async upload(prefix: string, file: File): Promise<string> {
    const path = `${prefix}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await this.supabase.client.storage.from(BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }

  async signedUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }
}
