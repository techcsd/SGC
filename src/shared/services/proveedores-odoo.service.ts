import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { Proveedor } from '../models/proveedor.model';
import { OdooProveedor, OdooProveedorEscritura } from '../models/odoo.model';
import { pickColumns } from '../utils/pick-columns.util';
import { OdooApiService } from './odoo-api.service';
import { ProveedorPayload } from './proveedores.service';

/** Columnas de sgc.proveedores que esta variante escribe: lo operativo + el espejo de lo fiscal. */
const PROVEEDOR_COLS_LOCAL = new Set<string>([
  'nombre', 'rnc', 'contacto', 'telefono', 'email', 'direccion', 'activo',
  'es_prueba', 'is_hardware_store', 'lat', 'lng', 'tipos',
]);

/** Campos que se escriben en Odoo (res.partner); el resto del formulario es operativo y se queda en SGC. */
const CAMPOS_ODOO = ['nombre', 'rnc', 'email', 'telefono', 'direccion', 'activo'] as const;

export type EstadoProveedores = 'activos' | 'inactivos' | 'todos';

export interface PaginaProveedores {
  proveedores: Proveedor[];
  hayMas: boolean;
}

const PREFIJO_SIN_FILA = 'odoo:';

/**
 * Variante «Odoo directo» de ProveedoresService (misma forma para la pantalla):
 * nombre, RNC, contacto fiscal y estado se leen y escriben en Odoo por el gateway; lo operativo
 * (tipos, ferretería, ubicación, contacto) vive en la fila local de sgc.proveedores enlazada por
 * `odoo_id`, que es a la que apuntan las demás tablas. La fila local refleja lo fiscal tras cada
 * escritura (la leen funciones SQL como ferreterias_visibles), pero la fuente es Odoo.
 */
@Injectable({ providedIn: 'root' })
export class ProveedoresOdooService {
  private supabase = inject(SupabaseService);
  private odoo = inject(OdooApiService);

  async getPagina(filtro: { termino: string; estado: EstadoProveedores; pagina: number }): Promise<PaginaProveedores> {
    const r = await this.odoo.buscarProveedores({
      termino: filtro.termino.trim() || undefined, estado: filtro.estado, pagina: filtro.pagina,
    });
    const locales = await this.localesPorOdooId(r.proveedores.map((p) => p.id));
    return {
      proveedores: r.proveedores.map((o) => this.componer(o, locales.get(o.id))),
      hayMas: r.hay_mas,
    };
  }

  async create(payload: ProveedorPayload): Promise<Proveedor> {
    const { proveedor } = await this.odoo.crearProveedor({ nombre: payload.nombre, ...this.fiscal(payload) });
    return this.guardarOperativo(proveedor, payload);
  }

  async update(actual: Proveedor, payload: Partial<ProveedorPayload>): Promise<Proveedor> {
    const odooId = actual.odoo_id;
    if (!odooId) throw new Error('Este proveedor no está vinculado a Odoo.');
    const cambios = this.fiscal(payload, actual);
    const proveedor = Object.keys(cambios).length
      ? await this.odoo.actualizarProveedor(odooId, cambios)
      : (await this.odoo.obtenerProveedores([odooId]))[0];
    if (!proveedor) throw new Error('El proveedor ya no existe en Odoo.');
    return this.guardarOperativo(proveedor, payload);
  }

  async toggleActivo(actual: Proveedor, activo: boolean): Promise<void> {
    if (!actual.odoo_id) throw new Error('Este proveedor no está vinculado a Odoo.');
    const proveedor = await this.odoo.actualizarProveedor(actual.odoo_id, { activo });
    if (!actual.id.startsWith(PREFIJO_SIN_FILA)) await this.reflejarLocal(actual.id, { activo: proveedor.activo });
  }

  /** Solo lo que cambió respecto de `actual`; al crear, lo informado (el nombre y el estado van aparte). */
  private fiscal(payload: Partial<ProveedorPayload>, actual?: Proveedor): OdooProveedorEscritura {
    const out: Record<string, unknown> = {};
    for (const k of CAMPOS_ODOO) {
      if (!actual && (k === 'nombre' || k === 'activo')) continue;
      if (payload[k] === undefined) continue;
      const nuevo = payload[k] ?? null;
      if (actual ? (actual[k] ?? null) === nuevo : nuevo === null) continue;
      out[k] = nuevo;
    }
    return out as OdooProveedorEscritura;
  }

  /** Asegura la fila local enlazada, y le escribe lo operativo + el espejo de lo que dice Odoo. */
  private async guardarOperativo(o: OdooProveedor, payload: Partial<ProveedorPayload>): Promise<Proveedor> {
    const { data: localId, error } = await this.supabase.client
      .schema('sgc')
      .rpc('asegurar_proveedor_odoo', { p_odoo_id: o.id, p_nombre: o.nombre });
    if (error) throw new Error(error.message);

    const cambios = pickColumns({
      ...this.espejo(o),
      contacto: payload.contacto, tipos: payload.tipos, is_hardware_store: payload.is_hardware_store,
      lat: payload.lat, lng: payload.lng, es_prueba: payload.es_prueba,
    }, PROVEEDOR_COLS_LOCAL);
    const { data, error: errUpd } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .update(cambios)
      .eq('id', localId as string)
      .select('*')
      .single();
    if (errUpd) throw new Error(errUpd.message);
    return this.componer(o, data as unknown as Proveedor);
  }

  private async reflejarLocal(id: string, cambios: Partial<ProveedorPayload>): Promise<void> {
    const { error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .update(pickColumns(cambios, PROVEEDOR_COLS_LOCAL))
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  private espejo(o: OdooProveedor): Partial<ProveedorPayload> {
    return { nombre: o.nombre, rnc: o.rnc, telefono: o.telefono, email: o.email, direccion: o.direccion, activo: o.activo };
  }

  private async localesPorOdooId(ids: number[]): Promise<Map<number, Proveedor>> {
    const mapa = new Map<number, Proveedor>();
    if (ids.length === 0) return mapa;
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('proveedores')
      .select('*')
      .in('odoo_id', ids);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as unknown as Proveedor[]) if (p.odoo_id) mapa.set(p.odoo_id, p);
    return mapa;
  }

  /** Lo fiscal sale de Odoo; lo operativo, de la fila local (vacío si todavía no existe). */
  private componer(o: OdooProveedor, local?: Proveedor): Proveedor {
    return {
      id: local?.id ?? `${PREFIJO_SIN_FILA}${o.id}`,
      odoo_id: o.id,
      nombre: o.nombre,
      rnc: o.rnc,
      telefono: o.telefono,
      email: o.email,
      direccion: o.direccion,
      activo: o.activo,
      contacto: local?.contacto ?? null,
      tipos: local?.tipos ?? [],
      is_hardware_store: local?.is_hardware_store ?? false,
      lat: local?.lat ?? null,
      lng: local?.lng ?? null,
      es_prueba: local?.es_prueba ?? false,
      created_at: local?.created_at ?? '',
    };
  }
}
