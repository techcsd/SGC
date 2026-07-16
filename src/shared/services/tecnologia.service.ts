import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  TecHerramienta,
  TecHerramientaFormData,
  TecMatrizEntry,
  TecEquipo,
  TecEquipoFormData,
  TecEquipoHistorial,
  TecCompraOpcion,
  TEC_EQUIPO_ESTADOS,
} from '../models/tecnologia.model';
import { formatFechaMedia } from '../utils/fecha.util';
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

  // QA-080 — puestos distintos (union de empleados.cargo + tec_matriz.puesto)
  // para alimentar el <datalist> del campo puesto y así deduplicar tipeos.
  // Best-effort: cualquier fallo devuelve [] sin romper la pantalla.
  async getPuestosSugeridos(): Promise<string[]> {
    try {
      const [cargosRes, matrizRes] = await Promise.all([
        this.supabase.client.from('empleados').select('cargo'),
        this.supabase.client.from('tec_matriz').select('puesto'),
      ]);
      const set = new Set<string>();
      for (const r of cargosRes.data ?? []) {
        const c = (r as { cargo?: string | null }).cargo?.trim();
        if (c) set.add(c);
      }
      for (const r of matrizRes.data ?? []) {
        const p = (r as { puesto?: string | null }).puesto?.trim();
        if (p) set.add(p);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
    } catch {
      return [];
    }
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

  /** QA-072 — Equipos TI activos asignados a un empleado (solo lectura, para RRHH). */
  async getEquiposByEmpleado(empleadoId: string): Promise<TecEquipo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_equipos')
      .select('*')
      .eq('empleado_id', empleadoId)
      .eq('activo', true)
      .order('codigo', { ascending: true });
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
    // QA-008 — capturamos el estado previo para registrar en el historial qué cambió
    // (estado / asignación). Sin esto, el historial solo mostraba "Equipo registrado".
    const { data: prevRow } = await this.supabase.client
      .from('tec_equipos')
      .select('estado, empleado_id')
      .eq('id', id)
      .single();

    const { error } = await this.supabase.client
      .from('tec_equipos')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);

    // Registra solo cambios relevantes; ignora actualizaciones silenciosas (ej. foto_path).
    if (prevRow) {
      const prev = prevRow as { estado?: string; empleado_id?: string | null };
      const cambios: string[] = [];
      let tipoCambio = 'edicion';
      if (payload.estado !== undefined && payload.estado !== prev.estado) {
        cambios.push(`Estado: ${this.estadoLabel(prev.estado)} → ${this.estadoLabel(payload.estado)}.`);
        tipoCambio = 'estado';
      }
      if (payload.empleado_id !== undefined && payload.empleado_id !== prev.empleado_id) {
        cambios.push(payload.empleado_id ? 'Reasignado a un empleado.' : 'Desasignado (sin empleado).');
        tipoCambio = 'asignacion';
      }
      if (cambios.length > 0) {
        await this.addHistorial(
          id,
          tipoCambio,
          cambios.join(' '),
          payload.empleado_id !== undefined ? payload.empleado_id : (prev.empleado_id ?? null),
        );
      }
    }
  }

  private estadoLabel(value: string | null | undefined): string {
    return TEC_EQUIPO_ESTADOS.find((e) => e.value === value)?.label ?? (value ?? '—');
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

  // QA-070 — opciones ligeras para el selector "Origen: compra tecnológica".
  // Lista las solicitudes de compra tecnológicas más recientes con una etiqueta
  // legible (fecha + resumen de renglones). Best-effort: [] ante cualquier error.
  async getComprasTecOpciones(limite = 30): Promise<TecCompraOpcion[]> {
    try {
      const { data, error } = await this.supabase.client
        .from('solicitudes_compra')
        .select('id, created_at, notas, items:solicitud_compra_items(descripcion)')
        .eq('categoria', 'tecnologia')
        .order('created_at', { ascending: false })
        .limit(limite);
      if (error) return [];
      return (data ?? []).map((row) => {
        const r = row as {
          id: string;
          created_at: string;
          notas: string | null;
          items?: { descripcion: string }[];
        };
        const resumen =
          r.items?.map((i) => i.descripcion).filter(Boolean).slice(0, 3).join(', ') ||
          r.notas ||
          'Compra tecnológica';
        return { id: r.id, label: `${formatFechaMedia(r.created_at)} — ${resumen}` };
      });
    } catch {
      return [];
    }
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
