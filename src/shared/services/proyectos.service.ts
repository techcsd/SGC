// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Run this SQL once to enable full admin access to all modules:
//
// update sgc.roles
//   set modulos = array['inventario','compras','rrhh','proyectos','flota','admin']
//   where codigo = 'admin';
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { FaseProyecto, Proyecto, ProyectoEstado } from '../models/proyecto.model';

@Injectable({ providedIn: 'root' })
export class ProyectosService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<Proyecto[]> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('*, responsable:usuarios(nombre), fases:fases_proyecto(*)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Proyecto[];
  }

  async getById(id: string): Promise<Proyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('*, responsable:usuarios(nombre), fases:fases_proyecto(*)')
      .eq('id', id)
      .order('orden', { referencedTable: 'fases_proyecto', ascending: true })
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  async generateNextCode(): Promise<string> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .select('codigo')
      .like('codigo', 'PROY-%')
      .order('codigo', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    const last = data?.[0]?.codigo as string | undefined;
    const lastNumber = last ? parseInt(last.replace('PROY-', ''), 10) || 0 : 0;
    return `PROY-${String(lastNumber + 1).padStart(4, '0')}`;
  }

  async create(payload: Partial<Proyecto>): Promise<Proyecto> {
    const codigo = await this.generateNextCode();
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .insert({ ...payload, codigo })
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  async update(id: string, payload: Partial<Proyecto>): Promise<Proyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, responsable:usuarios(nombre)')
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as Proyecto;
  }

  async updateEstado(id: string, estado: ProyectoEstado): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proyectos')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async createFase(fase: Partial<FaseProyecto>): Promise<FaseProyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .insert(fase)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as FaseProyecto;
  }

  async updateFase(id: string, payload: Partial<FaseProyecto>): Promise<FaseProyecto> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as FaseProyecto;
  }

  async deleteFase(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async updateProgreso(id: string, progreso: number): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('fases_proyecto')
      .update({ progreso })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}
