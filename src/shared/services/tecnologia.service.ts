import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  TecHerramienta,
  TecHerramientaFormData,
  TecMatrizEntry,
  TecEquipo,
  TecEquipoFormData,
  TecEquipoHistorial,
} from '../models/tecnologia.model';
import { SolicitudCompra } from '../models/solicitud.model';

@Injectable({ providedIn: 'root' })
export class TecnologiaService {
  private supabase = inject(SupabaseService);

  // ── Homologación de herramientas ──────────────────────────
  async getHerramientas(soloActivas = false): Promise<TecHerramienta[]> {
    let q = this.supabase.client.from('tec_herramientas').select('*').order('orden', { ascending: true });
    if (soloActivas) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecHerramienta[];
  }

  async createHerramienta(payload: TecHerramientaFormData): Promise<TecHerramienta> {
    const { data, error } = await this.supabase.client
      .from('tec_herramientas')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TecHerramienta;
  }

  async updateHerramienta(id: string, payload: Partial<TecHerramientaFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('tec_herramientas')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeHerramienta(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_herramientas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Matriz puesto × herramienta ───────────────────────────
  async getMatriz(): Promise<TecMatrizEntry[]> {
    const { data, error } = await this.supabase.client
      .from('tec_matriz')
      .select('*, herramienta:tec_herramientas(nombre, categoria)')
      .order('puesto', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecMatrizEntry[];
  }

  async addMatriz(payload: {
    puesto: string;
    herramienta_id: string;
    obligatorio: boolean;
    notas: string | null;
  }): Promise<TecMatrizEntry> {
    const { data, error } = await this.supabase.client
      .from('tec_matriz')
      .insert(payload)
      .select('*, herramienta:tec_herramientas(nombre, categoria)')
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as TecMatrizEntry;
  }

  async removeMatriz(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_matriz').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Inventario tecnológico ────────────────────────────────
  async getEquipos(): Promise<TecEquipo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecEquipo[];
  }

  async generateEquipoCodigo(): Promise<string> {
    const { data } = await this.supabase.client
      .from('tec_equipos')
      .select('codigo')
      .like('codigo', 'TEC-%')
      .order('codigo', { ascending: false })
      .limit(1);
    const last = (data?.[0] as { codigo?: string } | undefined)?.codigo;
    const n = last ? parseInt(last.replace('TEC-', ''), 10) || 0 : 0;
    return `TEC-${String(n + 1).padStart(4, '0')}`;
  }

  async createEquipo(payload: TecEquipoFormData): Promise<TecEquipo> {
    const codigo = await this.generateEquipoCodigo();
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .insert({ ...payload, codigo })
      .select('*, empleado:empleados(nombre, apellido, cargo)')
      .single();
    if (error) throw new Error(error.message);
    const equipo = data as unknown as TecEquipo;
    await this.addHistorial(equipo.id, 'asignacion', `Equipo registrado (estado: ${payload.estado}).`, payload.empleado_id);
    return equipo;
  }

  async updateEquipo(id: string, payload: Partial<TecEquipoFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('tec_equipos')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async removeEquipo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_equipos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── U17 — Foto del equipo (bucket privado `inventario`) ───────────────────
  async uploadEquipoFoto(equipoId: string, file: File): Promise<string> {
    const path = `tec-equipo/${equipoId}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('inventario')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(error.message);
    return path;
  }

  async getEquipoFotoUrl(path: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.storage
      .from('inventario')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  async getHistorial(equipoId: string): Promise<TecEquipoHistorial[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipo_historial')
      .select('*')
      .eq('equipo_id', equipoId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TecEquipoHistorial[];
  }

  async addHistorial(
    equipoId: string,
    tipoCambio: string,
    descripcion: string,
    empleadoId: string | null,
  ): Promise<void> {
    const usuarioId = (await this.supabase.client.auth.getUser()).data.user?.id ?? null;
    await this.supabase.client.from('tec_equipo_historial').insert({
      equipo_id: equipoId,
      tipo_cambio: tipoCambio,
      descripcion,
      empleado_id: empleadoId,
      usuario_id: usuarioId,
    });
  }

  // ── Compras tecnológicas (usa solicitudes_compra, categoria='tecnologia') ──
  async getComprasTec(): Promise<SolicitudCompra[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select('*, items:solicitud_compra_items(*)')
      .eq('categoria', 'tecnologia')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SolicitudCompra[];
  }

  async crearCompraTec(
    notas: string | null,
    items: { descripcion: string; cantidad: number; proveedor_sugerido: string | null; foto_path?: string | null }[],
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_solicitud_compra_tec', {
      p_notas: notas,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── U17 — Foto de un renglón de compra tecnológica (bucket `inventario`) ──
  async uploadCompraTecFoto(file: File): Promise<string> {
    const path = `compra-tec/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('inventario')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (error) throw new Error(error.message);
    return path;
  }
}
