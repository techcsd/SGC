import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Mantenimiento, MantenimientoFormData } from '../models/mantenimiento.model';

@Injectable({ providedIn: 'root' })
export class MantenimientosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Mantenimiento[]> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .order('fecha', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Mantenimiento[];
  }

  async create(payload: MantenimientoFormData): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .insert(payload)
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }

  async update(id: string, payload: Partial<MantenimientoFormData>): Promise<Mantenimiento> {
    const { data, error } = await this.supabase.client
      .from('mantenimientos')
      .update(payload)
      .eq('id', id)
      .select('*, vehiculo:vehiculos(placa,marca,modelo)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Mantenimiento;
  }

  // ── Maintenance photos (sgc.mantenimientos.fotos text[] + `vehiculos` bucket) ──

  /** Uploads one photo for a maintenance record and returns its storage path. */
  async uploadFoto(mantenimientoId: string, file: File): Promise<string> {
    const safeName = (file.name || 'foto')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40) || 'foto';
    const path = `mantenimiento/${mantenimientoId}/${crypto.randomUUID()}-${safeName}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);
    return path;
  }

  /** Resolves a stored photo path to a time-limited signed URL (null on failure). */
  async getFotoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  }

  /** Persists the full list of photo paths on the maintenance row. */
  async setFotos(mantenimientoId: string, fotos: string[]): Promise<void> {
    const { error } = await this.supabase.client
      .from('mantenimientos')
      .update({ fotos })
      .eq('id', mantenimientoId);
    if (error) throw new Error(error.message);
  }
}
