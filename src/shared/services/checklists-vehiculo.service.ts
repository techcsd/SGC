import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ChecklistPlantilla,
  ChecklistVehiculo,
  ChecklistFormData,
} from '../models/flota-checklist.model';

const BUCKET = 'vehiculos';

const LIST_QUERY =
  '*, vehiculo:vehiculos(placa, marca, modelo, tipo), conductor:conductores(nombre), plantilla:checklist_plantillas(nombre)';
const DETAIL_QUERY =
  '*, vehiculo:vehiculos(placa, marca, modelo, tipo), conductor:conductores(nombre), plantilla:checklist_plantillas(nombre), ' +
  'respuestas:checklist_vehiculo_respuestas(*), fotos:checklist_vehiculo_fotos(*)';

@Injectable({ providedIn: 'root' })
export class ChecklistsVehiculoService {
  private supabase = inject(SupabaseService);

  async getPlantillas(): Promise<ChecklistPlantilla[]> {
    const { data, error } = await this.supabase.client
      .from('checklist_plantillas')
      .select('*, items:checklist_plantilla_items(*)')
      .eq('activo', true)
      .order('orden', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ChecklistPlantilla[];
    // ordena los items de cada plantilla
    for (const p of rows) p.items?.sort((a, b) => a.orden - b.orden);
    return rows;
  }

  async getChecklists(): Promise<ChecklistVehiculo[]> {
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select(LIST_QUERY)
      .order('capturado_en', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ChecklistVehiculo[];
  }

  async getById(id: string): Promise<ChecklistVehiculo> {
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select(DETAIL_QUERY)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    const row = data as unknown as ChecklistVehiculo;
    row.respuestas?.sort((a, b) => a.orden - b.orden);
    return row;
  }

  /** Registra un checklist. Idempotente por UUID de cliente. */
  async registrar(payload: ChecklistFormData): Promise<string> {
    const id = crypto.randomUUID();
    const { data, error } = await this.supabase.client.rpc('registrar_checklist_vehiculo', {
      p_id: id,
      p_plantilla_id: payload.plantilla_id,
      p_vehiculo_id: payload.vehiculo_id,
      p_conductor_id: payload.conductor_id,
      p_tipo: payload.tipo,
      p_fecha: payload.fecha,
      p_datos: payload.datos,
      p_kilometraje: payload.kilometraje,
      p_respuestas: payload.respuestas,
      p_fotos: [],
      p_firma_path: null,
      p_observaciones: payload.observaciones,
      p_capturado_en: null, // el servidor usa now()
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? id;
  }

  async atender(id: string, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('atender_checklist_vehiculo', {
      p_id: id,
      p_nota: nota,
    });
    if (error) throw new Error(error.message);
  }

  /** Conteo para el badge de Flota: checklists con crítico en NO sin atender. */
  async countPendientesCriticos(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select('id', { count: 'exact', head: true })
      .eq('tiene_criticos', true)
      .eq('atendido', false);
    if (error) return 0;
    return count ?? 0;
  }

  async getFotoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }
}
