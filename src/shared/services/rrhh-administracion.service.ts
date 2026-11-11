import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ActivoCategoria, ActivoEstado, RrhhActivo, RrhhProveedorAdmin, RrhhTramite, TramiteTipo,
} from '../models/rrhh-administracion.model';

/** DN-29 — RRHH › Administración (Trámites construido esta ronda; Proveedores
 *  administrativos y Activos de oficina tienen esquema+RLS en dev, sin UI
 *  todavía — ver docs/RRHH-ADMIN.md). */
@Injectable({ providedIn: 'root' })
export class RrhhAdministracionService {
  private supabase = inject(SupabaseService);

  async listarTramites(): Promise<RrhhTramite[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_tramites')
      .select('*')
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhTramite[];
  }

  async crearTramite(payload: {
    nombre: string; tipo: TramiteTipo; entidad_responsable: string | null;
    numero_referencia: string | null; fecha_emision: string | null; fecha_vencimiento: string | null; notas: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_tramites').insert(payload);
    if (error) throw new Error(error.message);
  }

  async actualizarEstadoTramite(id: string, estado: RrhhTramite['estado']): Promise<void> {
    const { error } = await this.supabase.client
      .from('rrhh_tramites')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarTramite(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_tramites').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Proveedores administrativos (DN-29, distinto de compras.proveedores) ──
  async listarProveedoresAdmin(): Promise<RrhhProveedorAdmin[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_proveedores_admin')
      .select('*')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhProveedorAdmin[];
  }

  async crearProveedorAdmin(payload: {
    nombre: string; servicio: string | null; contacto_nombre: string | null;
    contacto_telefono: string | null; contacto_email: string | null;
    contrato_desde: string | null; contrato_hasta: string | null; monto_mensual: number | null; notas: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_proveedores_admin').insert(payload);
    if (error) throw new Error(error.message);
  }

  async toggleActivoProveedor(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_proveedores_admin').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarProveedorAdmin(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_proveedores_admin').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Activos de oficina (DN-29, distinto del inventario tecnológico) ──────
  async listarActivos(): Promise<RrhhActivo[]> {
    const { data, error } = await this.supabase.client
      .from('rrhh_activos')
      .select('*')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhActivo[];
  }

  async crearActivo(payload: {
    nombre: string; categoria: ActivoCategoria; ubicacion: string | null;
    fecha_adquisicion: string | null; valor: number | null; proximo_mantenimiento: string | null; notas: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_activos').insert(payload);
    if (error) throw new Error(error.message);
  }

  async actualizarEstadoActivo(id: string, estado: ActivoEstado): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_activos').update({ estado }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async eliminarActivo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('rrhh_activos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
