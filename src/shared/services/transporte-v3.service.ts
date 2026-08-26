import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { NotificacionesService } from './notificaciones.service';

// ── BA / Transporte v3 — capa de datos (conduce externo, proveedores, viajes,
//    lugares «Otros»). Servicio delgado: solo envuelve los RPCs; el estado vive
//    en cada página (patrón de la casa). ──────────────────────────────────────

export interface ProveedorTransporte {
  id: string;
  nombre: string;
  telefono: string | null;
  contacto: string | null;
  rnc: string | null;
  estado: 'sin_ratificar' | 'ratificado';
  activo: boolean;
  es_prueba: boolean;
  created_at: string;
  viajes_total: number;
  viajes_pendientes_pago: number;
}

export interface ConduceExternoRow {
  id: string;
  transporta: string | null;
  es_proveedor_formal: boolean;
  estado: 'emitido' | 'recibido' | 'anulado';
  origen: string | null;
  destino: string | null;
  material: string | null;
  afecta_inventario: boolean;
  placa_foto_path: string | null;
  carga_foto_path: string | null;
  recepcion_foto_path: string | null;
  emisor_nombre: string | null;
  recibido_por_nombre: string | null;
  recibido_en: string | null;
  created_at: string;
  es_prueba: boolean;
  requisicion_id: string | null;
}

export interface ViajeProveedor {
  viaje_id: string;
  conduce_externo_id: string | null;
  fecha: string;
  estado_pago: 'pendiente_pago' | 'pagado';
  pagado_en: string | null;
  origen: string | null;
  destino: string | null;
  material: string | null;
  es_prueba: boolean;
}

export interface LugarPendiente {
  id: string;
  texto: string;
  usado_por_nombre: string | null;
  documento_tipo: string | null;
  documento_id: string | null;
  contexto: string | null;
  estado: 'pendiente' | 'promovido' | 'descartado';
  created_at: string;
  es_prueba: boolean;
}

export interface LugarBuscado {
  tipo: 'obra' | 'almacen' | 'lugar';
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  detalle: string | null;
}

export interface CrearConduceExternoInput {
  proveedorId?: string | null;
  transportaTexto?: string | null;
  placaFotoPath: string;
  cargaFotoPath?: string | null;
  materialDescripcion?: string | null;
  origen?: string | null;
  origenLat?: number | null;
  origenLng?: number | null;
  origenProyectoId?: string | null;
  origenBodegaId?: string | null;
  destino?: string | null;
  destinoLat?: number | null;
  destinoLng?: number | null;
  destinoProyectoId?: string | null;
  destinoBodegaId?: string | null;
  emisorFirmaPath?: string | null;
  origenRequisicionId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TransporteV3Service {
  private supabase = inject(SupabaseService);
  private notificaciones = inject(NotificacionesService);

  // ── Proveedores de transporte ────────────────────────────────────────────
  async proveedores(soloPorRatificar = false): Promise<ProveedorTransporte[]> {
    const { data, error } = await this.supabase.client.rpc('proveedores_transporte_listado', {
      p_solo_por_ratificar: soloPorRatificar,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ProveedorTransporte[];
  }

  async crearProveedor(p: { nombre: string; telefono?: string | null; contacto?: string | null; rnc?: string | null; notas?: string | null }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('proveedor_transporte_crear', {
      p_nombre: p.nombre,
      p_telefono: p.telefono ?? null,
      p_contacto: p.contacto ?? null,
      p_rnc: p.rnc ?? null,
      p_notas: p.notas ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async ratificarProveedor(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('proveedor_transporte_ratificar', { p_id: id });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  async viajesDeProveedor(proveedorId: string | null, texto: string | null, desde?: string | null, hasta?: string | null): Promise<ViajeProveedor[]> {
    const { data, error } = await this.supabase.client.rpc('viajes_de_proveedor', {
      p_proveedor_id: proveedorId,
      p_proveedor_texto: texto,
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ViajeProveedor[];
  }

  async marcarViajePagado(viajeId: string, pagado: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('viaje_marcar_pagado', { p_viaje_id: viajeId, p_pagado: pagado });
    if (error) throw new Error(error.message);
  }

  // ── Conduce externo ──────────────────────────────────────────────────────
  async conducesExternos(estado?: string | null, limite = 200): Promise<ConduceExternoRow[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_externos_listado', {
      p_estado: estado ?? null,
      p_limite: limite,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConduceExternoRow[];
  }

  async crearConduceExterno(i: CrearConduceExternoInput): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_conduce_externo', {
      p_transporta_proveedor_id: i.proveedorId ?? null,
      p_transporta_texto: i.transportaTexto ?? null,
      p_placa_foto_path: i.placaFotoPath,
      p_carga_foto_path: i.cargaFotoPath ?? null,
      p_material_descripcion: i.materialDescripcion ?? null,
      p_items: null,
      p_origen: i.origen ?? null,
      p_origen_lat: i.origenLat ?? null,
      p_origen_lng: i.origenLng ?? null,
      p_origen_proyecto_id: i.origenProyectoId ?? null,
      p_origen_bodega_id: i.origenBodegaId ?? null,
      p_destino: i.destino ?? null,
      p_destino_lat: i.destinoLat ?? null,
      p_destino_lng: i.destinoLng ?? null,
      p_destino_proyecto_id: i.destinoProyectoId ?? null,
      p_destino_bodega_id: i.destinoBodegaId ?? null,
      p_emisor_firma_path: i.emisorFirmaPath ?? null,
      p_origen_requisicion_id: i.origenRequisicionId ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async confirmarRecepcionExterno(id: string, fotoPath: string, firmaPath: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('conduce_externo_confirmar_receptor', {
      p_id: id,
      p_foto_path: fotoPath,
      p_firma_path: firmaPath,
      p_notas: notas ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async anularConduceExterno(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('conduce_externo_anular', { p_id: id, p_motivo: motivo });
    if (error) throw new Error(error.message);
  }

  // ── Lugares «Otros» ──────────────────────────────────────────────────────
  async buscarLugares(q: string): Promise<LugarBuscado[]> {
    const { data, error } = await this.supabase.client.rpc('buscar_lugares', { p_q: q });
    if (error) return [];
    return (data ?? []) as LugarBuscado[];
  }

  async lugaresPorRegistrar(estado: string | null = 'pendiente'): Promise<LugarPendiente[]> {
    const { data, error } = await this.supabase.client.rpc('lugares_por_registrar_listado', { p_estado: estado });
    if (error) throw new Error(error.message);
    return (data ?? []) as LugarPendiente[];
  }

  async promoverLugar(pendienteId: string, nombre: string, lat?: number | null, lng?: number | null): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('lugar_promover', {
      p_pendiente_id: pendienteId,
      p_nombre: nombre,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  async descartarLugar(pendienteId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('lugar_descartar_pendiente', { p_pendiente_id: pendienteId });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  // ── Fotos (bucket privado `conduces`) ────────────────────────────────────
  async subirFoto(kind: 'placa' | 'carga' | 'recepcion', file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `conduce-externo/${kind}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('conduces').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }
}
