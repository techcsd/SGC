import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  TecProveedor,
  TecProveedorBusqueda,
  TecProveedorCategoria,
  TecProveedorCompraRef,
  TecProveedorContacto,
  TecProveedorContactoFormData,
  TecProveedorCotizacionRef,
  TecProveedorFactura,
  TecProveedorFacturaFormData,
  TecProveedorFormData,
  TecProveedorPorRevisar,
  TecProveedorTrabajo,
  TecProveedorTrabajoFormData,
} from '../models/tec-proveedor.model';
import { pickColumns } from '../utils/pick-columns.util';

/** BN3 (regla 10) — columnas reales de cada tabla (sql/2026-11-24-ea1-tec-proveedores.sql). */
const PROVEEDOR_COLS = new Set<string>([
  'nombre', 'nombre_comercial', 'rnc', 'categoria_id', 'servicio', 'etiquetas', 'direccion',
  'ciudad', 'web', 'notas', 'estado', 'valoracion', 'creado_por',
]);
const CONTACTO_COLS = new Set<string>([
  'proveedor_id', 'nombre', 'cargo', 'telefono', 'whatsapp', 'correo', 'principal', 'notas',
]);
const TRABAJO_COLS = new Set<string>([
  'proveedor_id', 'fecha', 'titulo', 'descripcion', 'costo', 'moneda', 'estado', 'cotizacion_id',
  'solicitud_compra_id', 'equipo_id', 'creado_por',
]);
const FACTURA_COLS = new Set<string>([
  'proveedor_id', 'numero', 'fecha', 'monto', 'itbis', 'moneda', 'estado', 'fecha_pago',
  'archivo_path', 'archivo_nombre', 'trabajo_id', 'cotizacion_id', 'solicitud_compra_id', 'notas', 'creado_por',
]);

const BUCKET = 'tec-proveedores';

/**
 * EA1 — Proveedores de tecnología. Lectura: submódulo `tecnologia.proveedores` (ver);
 * escritura: operar (RLS + RPCs definer). Compras y admin solo ven.
 */
@Injectable({ providedIn: 'root' })
export class TecProveedoresService {
  private supabase = inject(SupabaseService);

  // ── Búsqueda única ────────────────────────────────────────────────────────
  async buscar(q: string, incluirInactivos = false): Promise<TecProveedorBusqueda[]> {
    const { data, error } = await this.supabase.client.rpc('buscar_tec_proveedores', {
      p_q: q.trim() || null,
      p_incluir_inactivos: incluirInactivos,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorBusqueda[];
  }

  async porRevisar(): Promise<TecProveedorPorRevisar[]> {
    const { data, error } = await this.supabase.client.rpc('tec_proveedores_por_revisar');
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorPorRevisar[];
  }

  // ── Catálogo de categorías ────────────────────────────────────────────────
  async getCategorias(): Promise<TecProveedorCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('tec_proveedor_categorias')
      .select('id, nombre, orden, activa')
      .order('orden')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorCategoria[];
  }

  // ── Proveedor ─────────────────────────────────────────────────────────────
  async getProveedor(id: string): Promise<TecProveedor | null> {
    const { data, error } = await this.supabase.client
      .from('tec_proveedores')
      .select('*, categoria:tec_proveedor_categorias(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as unknown as TecProveedor | null;
  }

  async crearProveedor(payload: TecProveedorFormData): Promise<string> {
    const { data: u } = await this.supabase.client.auth.getUser();
    const { data, error } = await this.supabase.client
      .from('tec_proveedores')
      .insert(pickColumns({ ...payload, creado_por: u.user?.id ?? null }, PROVEEDOR_COLS))
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async actualizarProveedor(id: string, payload: Partial<TecProveedorFormData>): Promise<void> {
    const { error } = await this.supabase.client
      .from('tec_proveedores')
      .update(pickColumns(payload, PROVEEDOR_COLS))
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Contactos ─────────────────────────────────────────────────────────────
  async getContactos(proveedorId: string): Promise<TecProveedorContacto[]> {
    const { data, error } = await this.supabase.client
      .from('tec_proveedor_contactos')
      .select('*')
      .eq('proveedor_id', proveedorId)
      .order('principal', { ascending: false })
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorContacto[];
  }

  async guardarContacto(proveedorId: string, payload: TecProveedorContactoFormData, id?: string): Promise<void> {
    // Un solo principal por proveedor (índice único parcial): se baja el anterior primero.
    if (payload.principal) {
      const { error: e0 } = await this.supabase.client
        .from('tec_proveedor_contactos')
        .update({ principal: false })
        .eq('proveedor_id', proveedorId)
        .eq('principal', true)
        .neq('id', id ?? '00000000-0000-0000-0000-000000000000');
      if (e0) throw new Error(e0.message);
    }
    const row = pickColumns({ ...payload, proveedor_id: proveedorId }, CONTACTO_COLS);
    const q = id
      ? this.supabase.client.from('tec_proveedor_contactos').update(row).eq('id', id)
      : this.supabase.client.from('tec_proveedor_contactos').insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async eliminarContacto(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_proveedor_contactos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Trabajos ──────────────────────────────────────────────────────────────
  async getTrabajos(proveedorId: string): Promise<TecProveedorTrabajo[]> {
    const { data, error } = await this.supabase.client
      .from('tec_proveedor_trabajos')
      .select('*')
      .eq('proveedor_id', proveedorId)
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorTrabajo[];
  }

  async guardarTrabajo(proveedorId: string, payload: TecProveedorTrabajoFormData, id?: string): Promise<void> {
    const row = pickColumns({ ...payload, proveedor_id: proveedorId }, TRABAJO_COLS);
    const q = id
      ? this.supabase.client.from('tec_proveedor_trabajos').update(row).eq('id', id)
      : this.supabase.client.from('tec_proveedor_trabajos').insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async eliminarTrabajo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_proveedor_trabajos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Facturas ──────────────────────────────────────────────────────────────
  async getFacturas(proveedorId: string): Promise<TecProveedorFactura[]> {
    const { data, error } = await this.supabase.client
      .from('tec_proveedor_facturas')
      .select('*')
      .eq('proveedor_id', proveedorId)
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorFactura[];
  }

  /** Crea/actualiza la factura; si viene `archivo`, lo sube a `tec-proveedores/<proveedor>/…` y fija su ruta. */
  async guardarFactura(proveedorId: string, payload: TecProveedorFacturaFormData, archivo?: File | null, id?: string): Promise<void> {
    const row: Record<string, unknown> = { ...payload, proveedor_id: proveedorId };
    if (archivo) {
      const path = `${proveedorId}/${crypto.randomUUID()}-${archivo.name}`;
      const { error: upErr } = await this.supabase.client.storage.from(BUCKET).upload(path, archivo);
      if (upErr) throw new Error(upErr.message);
      row['archivo_path'] = path;
      row['archivo_nombre'] = archivo.name;
    }
    if (!id) {
      const { data: u } = await this.supabase.client.auth.getUser();
      row['creado_por'] = u.user?.id ?? null;
    }
    const clean = pickColumns(row, FACTURA_COLS);
    const q = id
      ? this.supabase.client.from('tec_proveedor_facturas').update(clean).eq('id', id)
      : this.supabase.client.from('tec_proveedor_facturas').insert(clean);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async eliminarFactura(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('tec_proveedor_facturas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getArchivoUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  // ── Cotizaciones / compras vinculadas ─────────────────────────────────────
  async getCotizaciones(proveedorId: string): Promise<TecProveedorCotizacionRef[]> {
    const { data, error } = await this.supabase.client
      .from('tec_cotizaciones')
      .select('id, titulo, fecha, moneda, total, estado')
      .eq('proveedor_id', proveedorId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorCotizacionRef[];
  }

  async getCompras(proveedorId: string): Promise<TecProveedorCompraRef[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select('id, created_at, estado, notas')
      .eq('categoria', 'tecnologia')
      .eq('proveedor_tec_id', proveedorId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TecProveedorCompraRef[];
  }

  /** «¿Crear proveedor “X”?» desde una cotización: crea (o reutiliza por nombre normalizado) y vincula. */
  async crearDesdeCotizacion(cotizacionId: string, nombre?: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('tec_proveedor_crear_desde_cotizacion', {
      p_cotizacion_id: cotizacionId,
      p_nombre: nombre?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async desvincular(vinculo: { cotizacionId?: string; solicitudCompraId?: string }): Promise<void> {
    const { error } = await this.supabase.client.rpc('tec_proveedor_desvincular', {
      p_cotizacion_id: vinculo.cotizacionId ?? null,
      p_solicitud_compra_id: vinculo.solicitudCompraId ?? null,
    });
    if (error) throw new Error(error.message);
  }
}

/** Enlaces de contacto con un toque. Solo dígitos para wa.me; tel: conserva el +. */
export function enlaceLlamar(tel: string | null | undefined): string | null {
  const t = (tel ?? '').replace(/[^\d+]/g, '');
  return t ? `tel:${t}` : null;
}
export function enlaceWhatsapp(tel: string | null | undefined): string | null {
  let d = (tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  // RD: número local de 10 dígitos (809/829/849) → prefijo país 1.
  if (d.length === 10) d = '1' + d;
  return `https://wa.me/${d}`;
}
export function enlaceCorreo(correo: string | null | undefined): string | null {
  const c = (correo ?? '').trim();
  return c && c.includes('@') ? `mailto:${c}` : null;
}
