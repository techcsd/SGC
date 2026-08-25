import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { SignedUrlCache, ImgTransform } from './signed-url-cache.service';
import { SalidaInventario, SalidaFormData, SalidaFirma, ConduceListadoRow } from '../models/salida.model';
import { NotificacionesService } from './notificaciones.service';

/** AK1 — fila del historial de confirmaciones de entrega (RPC confirmaciones_historial). */
export interface ConfirmacionHistorial {
  id: string;
  fecha: string;
  created_at: string;
  proyecto_id: string | null;
  proyecto: string | null;
  // AQ12 — destino puede ser una obra o la Bodega Central (destino_almacen_id).
  destino_almacen_id: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string;
  fase: string;
  entregado_por: string | null;
  entregado_por_nombre: string | null;
  entregado_en: string | null;
  recibido_por: string | null;
  recibido_por_nombre: string | null;
  recibido_en: string | null;
  tiene_foto: boolean;
  tiene_firma: boolean;
}

/** AL8 — fila cruda del RPC `mis_confirmaciones` (subconjunto de AK1). */
interface MiConfirmacionRow {
  id: string;
  fecha: string;
  created_at: string;
  proyecto_id: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string;
  fase: string;
  entregado_por: string | null;
  entregado_por_nombre: string | null;
  entregado_en: string | null;
  recibido_en: string | null;
  tiene_foto: boolean;
  tiene_firma: boolean;
  incompleta: boolean;
}

// usuarios is joined twice (creado_por, recibido_por) — must be disambiguated
// with !fkey_name or PostgREST rejects the embed as ambiguous.
const SELECT_QUERY =
  // AN5 — `salidas_inventario` tiene DOS FKs a bodegas (bodega_id origen +
  // destino_almacen_id, AL10). El embed a bodegas debe fijar la relación
  // explícita o PostgREST lo rechaza como ambiguo.
  '*, bodega:bodegas!salidas_inventario_bodega_id_fkey(nombre),' +
  ' destino_almacen:bodegas!salidas_inventario_destino_almacen_id_fkey(nombre),' +
  ' proyecto:proyectos(nombre), conductor:conductores(nombre), vehiculo:vehiculos(placa, marca, modelo, color),' +
  ' recibido:usuarios!salidas_inventario_recibido_por_fkey(nombre),' +
  ' entregado:usuarios!salidas_inventario_entregado_por_fkey(nombre),' +
  ' creado:usuarios!salidas_inventario_creado_por_fkey(nombre),' +
  ' detalle_salidas(*, articulo:articulos(nombre, codigo, unidad))';

@Injectable({ providedIn: 'root' })
export class SalidasService {
  private supabase = inject(SupabaseService);
  private cache = inject(SignedUrlCache);
  private notificaciones = inject(NotificacionesService);

  async getAll(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  /** AO5/AP4 — Listado web de conduces con fase + bucket + columnas de obra origen
   *  y de responsable (emisor/chofer/receptor). Filtros opcionales server-side. */
  async getConducesWebListado(filtros?: {
    obraOrigen?: string | null;
    obraDestino?: string | null;
    responsable?: string | null;
    desde?: string | null;
    hasta?: string | null;
    busqueda?: string | null;
  }): Promise<ConduceListadoRow[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_web_listado', {
      p_obra_origen: filtros?.obraOrigen ?? null,
      p_obra_destino: filtros?.obraDestino ?? null,
      p_responsable: filtros?.responsable ?? null,
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
      p_busqueda: filtros?.busqueda ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConduceListadoRow[];
  }

  /** AP4 — directorio de usuarios (id+nombre) para el filtro por responsable. */
  async getUsuariosDirectorio(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_usuarios_detalle');
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; nombre: string }[]).map((u) => ({ id: u.id, nombre: u.nombre }));
  }

  /** AK1 — Historial de confirmaciones de entrega (matriz de visibilidad server-side). */
  async getConfirmacionesHistorial(filtros?: {
    desde?: string | null;
    hasta?: string | null;
    proyectoId?: string | null;
    estado?: 'completa' | 'incompleta' | null;
  }): Promise<ConfirmacionHistorial[]> {
    const { data, error } = await this.supabase.client.rpc('confirmaciones_historial', {
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
      p_proyecto_id: filtros?.proyectoId ?? null,
      p_estado: filtros?.estado ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConfirmacionHistorial[];
  }

  /** AL8 — "Mis confirmaciones": solo lo que el usuario actual confirmó (RPC
   *  `mis_confirmaciones`, subconjunto de AK1). Se mapea a `ConfirmacionHistorial`
   *  para reutilizar el mismo layout de tabla. El RPC no devuelve `recibido_por_nombre`
   *  (siempre soy yo); la página lo rellena con el nombre del usuario en sesión. */
  async getMisConfirmaciones(filtros?: {
    desde?: string | null;
    hasta?: string | null;
  }): Promise<ConfirmacionHistorial[]> {
    const { data, error } = await this.supabase.client.rpc('mis_confirmaciones', {
      p_desde: filtros?.desde ?? null,
      p_hasta: filtros?.hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MiConfirmacionRow[]).map((r) => ({
      id: r.id,
      fecha: r.fecha,
      created_at: r.created_at,
      proyecto_id: r.proyecto_id,
      proyecto: r.destino,
      destino_almacen_id: null,
      destino: r.destino,
      bodega: r.bodega,
      estado: r.estado,
      fase: r.fase,
      entregado_por: r.entregado_por,
      entregado_por_nombre: r.entregado_por_nombre,
      entregado_en: r.entregado_en,
      recibido_por: null,
      recibido_por_nombre: null,
      recibido_en: r.recibido_en,
      tiene_foto: r.tiene_foto,
      tiene_firma: r.tiene_firma,
    }));
  }

  /** Sube una foto de evidencia (web) al bucket `inventario` y la enlaza a la salida.
   *  Paridad con la app de campo: lo que la móvil captura, la web también. */
  async subirFoto(salidaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `salida/${salidaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    const { error: updErr } = await this.supabase.client
      .from('salidas_inventario')
      .update({ foto_path: path })
      .eq('id', salidaId);
    if (updErr) throw new Error(updErr.message);
    return path;
  }

  /** Sube evidencia de entrega del conduce (firma/foto) al bucket `conduces`. */
  async subirEvidenciaConduce(
    salidaId: string,
    tipo: 'firma' | 'foto' | 'firma-emisor' | 'firma-receptor',
    data: Blob | File,
    ext: string,
  ): Promise<string> {
    const path = `salida/${salidaId}/${tipo}-${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage.from('conduces').upload(path, data);
    if (error) throw new Error(error.message);
    return path;
  }

  /** Cierre de conduce por el chofer (paridad app de campo): registra receptor,
   *  firma, foto y cantidades entregadas. Devuelve el estado resultante. */
  async entregarConduce(
    salidaId: string,
    items: { detalle_id: string; cantidad_recibida: number }[],
    receptor: string,
    firmaPath: string | null,
    fotoPath: string | null,
    notas: string | null,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('entregar_conduce', {
      p_salida_id: salidaId,
      p_items: items,
      p_receptor: receptor,
      p_firma_url: firmaPath,
      p_foto_url: fotoPath,
      p_notas: notas,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  /** AQ10 — Elimina (anula) un conduce pendiente: soft-delete + reversión de stock
   *  + cancelación de ruta + auditoría (server-side). Solo emisor mientras pendiente o admin. */
  async anularConduce(salidaId: string, motivo: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('anular_conduce', {
      p_salida_id: salidaId,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** AM5/AY12 — inicia (o adjunta) la ruta de un conduce. Paridad web con la app. */
  async iniciarRuta(salidaId: string, vehiculoId: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('conduce_iniciar_ruta', {
      p_salida_id: salidaId,
      p_vehiculo_id: vehiculoId,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** AM4/AY12 — ofrece la transferencia del conduce a otro chofer (portador). */
  async ofrecerTransferencia(salidaId: string, aConductorId: string, notas?: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('ofrecer_transferencia_conduce', {
      p_salida_id: salidaId,
      p_a_conductor_id: aConductorId,
      p_notas: notas ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** Choferes elegibles para transferir/asignar (reusa el picker de conductores). */
  async getConductoresPicker(): Promise<{ id: string; nombre: string }[]> {
    const { data, error } = await this.supabase.client.rpc('conductores_para_multa');
    if (error) return [];
    return (data ?? []) as { id: string; nombre: string }[];
  }

  /** AT16 — receptores elegibles para confirmar la entrega en una obra (rol/vínculo).
   *  Paridad con la app: al emitir el conduce se puede designar quién lo recibirá. */
  async getReceptoresDisponibles(
    proyectoId: string | null,
    bodegaId: string | null,
  ): Promise<{ id: string; nombre: string; detalle: string | null; vinculado: boolean }[]> {
    const { data, error } = await this.supabase.client.rpc('receptores_disponibles', {
      p_proyecto_id: proyectoId,
      p_bodega_id: bodegaId,
    });
    if (error) return [];
    return (data ?? []) as { id: string; nombre: string; detalle: string | null; vinculado: boolean }[];
  }

  /** AT16 — designa al receptor que confirmará la entrega (firma pendiente). Se le
   *  notifica para que confirme en su dispositivo. No bloquea el alta del conduce. */
  async asignarFirmaPendiente(salidaId: string, usuarioId: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('asignar_firma_pendiente', {
      p_salida_id: salidaId,
      p_usuario_id: usuarioId,
      p_nombre: nombre,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** AC7 — registra (upsert) una firma canónica del conduce (emisor/receptor) en
   *  `sgc.salida_firmas` vía RPC `firmar_conduce`. Devuelve el id de la firma. */
  async firmarConduce(
    salidaId: string,
    rol: 'emisor' | 'receptor',
    nombre: string,
    firmaPath: string,
    opts?: { cedula?: string | null; rolDesc?: string | null; metodo?: 'pad' | 'foto'; usuarioId?: string | null },
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('firmar_conduce', {
      p_salida_id: salidaId,
      p_rol: rol,
      p_nombre: nombre,
      p_firma_path: firmaPath,
      p_cedula: opts?.cedula ?? null,
      p_rol_desc: opts?.rolDesc ?? null,
      p_metodo: opts?.metodo ?? 'pad',
      p_usuario_id: opts?.usuarioId ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** AC7 — firmas canónicas de un conduce (emisor primero, receptor después). */
  async getFirmas(salidaId: string): Promise<SalidaFirma[]> {
    const { data, error } = await this.supabase.client
      .from('salida_firmas')
      .select('*')
      .eq('salida_id', salidaId)
      .order('rol', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaFirma[];
  }

  /** Signed URL for the field-captured evidence photo (private `inventario` bucket). */
  async getFotoUrl(path: string, transform?: ImgTransform): Promise<string> {
    return this.cache.signed('inventario', path, transform);
  }

  async getById(id: string): Promise<SalidaInventario> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    return data as unknown as SalidaInventario;
  }

  /** AE5 — ruta/parada en la que viaja este conduce (null si no está asociado a ninguna). */
  /** AF23 — fase del ciclo de vida del conduce (emitido/en_transito/entregado/confirmado/pendiente_firma). */
  async getFase(salidaId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.rpc('conduce_fase', { p_salida_id: salidaId });
    if (error) return null;
    return (data as string) ?? null;
  }

  async getRutaInfo(salidaId: string): Promise<ConduceRutaInfo | null> {
    const { data, error } = await this.supabase.client.rpc('conduce_ruta_info', { p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    return (data as ConduceRutaInfo | null) ?? null;
  }

  /** Atomic insert (header + items) with server-side stock validation, via RPC. */
  async create(payload: SalidaFormData, userId: string | null): Promise<SalidaInventario> {
    const { items, conductor_id, vehiculo_id, ...header } = payload;

    const { data: salidaId, error } = await this.supabase.client.rpc('registrar_salida_inventario', {
      p_fecha: header.fecha,
      p_bodega_id: header.bodega_id,
      p_proyecto_id: header.proyecto_id,
      p_motivo: header.motivo,
      p_responsable: header.responsable,
      p_observaciones: header.observaciones,
      p_creado_por: userId,
      p_items: items,
    });

    if (error) throw new Error(error.message);

    // Transporte is optional and recorded separately — registrar_salida_inventario
    // only handles the header + items RPC signature already in use elsewhere.
    // AL10 — destino_almacen_id (Bodega Central) también se fija aquí (post-insert).
    const extra: Record<string, unknown> = {};
    if (conductor_id || vehiculo_id) {
      extra['conductor_id'] = conductor_id;
      extra['vehiculo_id'] = vehiculo_id;
    }
    if (header.destino_almacen_id) extra['destino_almacen_id'] = header.destino_almacen_id;
    if (Object.keys(extra).length) {
      await this.supabase.client
        .from('salidas_inventario')
        .update(extra)
        .eq('id', salidaId as string);
    }

    const { data, error: fetchError } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('id', salidaId as string)
      .single();

    if (fetchError) throw new Error(fetchError.message);
    this.notificaciones.refresh();
    return data as unknown as SalidaInventario;
  }

  /**
   * AI2 — Universo del select "Despachante" (quien entrega el material al chofer):
   * usuarios + empleados activos. Si el origen es ferretería/otros, la app usa
   * nombre libre (despachante_nombre) sin elegir de esta lista.
   */
  async getDespachantes(
    bodegaId?: string | null,
    proyectoId?: string | null,
  ): Promise<{ tipo: 'usuario' | 'empleado'; id: string; nombre: string; detalle: string | null; vinculado?: boolean }[]> {
    const { data, error } = await this.supabase.client.rpc('despachantes_disponibles', {
      p_bodega_id: bodegaId ?? null,
      p_proyecto_id: proyectoId ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as { tipo: 'usuario' | 'empleado'; id: string; nombre: string; detalle: string | null; vinculado?: boolean }[];
  }

  /** AV5 — designa (server-side, con elegibilidad AV1) el despachante de un conduce
   *  recién creado en la web, para que firme remoto desde su bandeja "Por firmar". */
  async asignarDespachante(salidaId: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('asignar_despachante_conduce', {
      p_salida_id: salidaId,
      p_usuario_id: usuarioId,
    });
    if (error) throw new Error(error.message);
  }

  /** AV5 — feature flag del wizard de conduce en la web (toggle sin deploy desde
   *  Administración › Parámetros). Default false. */
  async wizardConduceHabilitado(): Promise<boolean> {
    const { data, error } = await this.supabase.client
      .schema('sgc')
      .from('parametros')
      .select('valor')
      .eq('clave', 'conduce_wizard_web_habilitado')
      .maybeSingle();
    if (error) return false;
    return String((data as { valor?: string } | null)?.valor ?? '').toLowerCase() === 'true';
  }

  /**
   * AI2 — Conduce simplificado del chofer: despachante + foto de recepción (carga)
   * + firmas chofer (transportista) y despachante (emisor). Envuelve el flujo AF23
   * (auto-ruta). Devuelve el id del conduce creado.
   */
  async crearConduceSimple(payload: {
    id: string;
    fecha: string;
    bodega_id: string | null;
    proyecto_id: string | null;
    observaciones: string | null;
    vehiculo_id: string | null;
    ruta_id: string | null;
    items: unknown[];
    despachante_nombre?: string | null;
    despachante_usuario_id?: string | null;
    despachante_empleado_id?: string | null;
    carga_foto_path?: string | null;
    firma_chofer_path?: string | null;
    firma_despachante_path?: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_conduce_simple', {
      p_id: payload.id,
      p_fecha: payload.fecha,
      p_bodega_id: payload.bodega_id,
      p_proyecto_id: payload.proyecto_id,
      p_observaciones: payload.observaciones,
      p_vehiculo_id: payload.vehiculo_id,
      p_ruta_id: payload.ruta_id,
      p_items: payload.items,
      p_despachante_nombre: payload.despachante_nombre ?? null,
      p_despachante_usuario_id: payload.despachante_usuario_id ?? null,
      p_despachante_empleado_id: payload.despachante_empleado_id ?? null,
      p_carga_foto_path: payload.carga_foto_path ?? null,
      p_firma_chofer_path: payload.firma_chofer_path ?? null,
      p_firma_despachante_path: payload.firma_despachante_path ?? null,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  /** AI2 — Conduces del chofer pendientes de entrega (badge "Pendiente entrega"). */
  async getPendientesEntrega(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  /** AI2 — Conteo de conduces pendientes de entrega (para el badge del menú). */
  async countPendientesEntrega(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_pendientes_entrega_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** AU1/AS2 — Bandeja "Conduces por firmar" del despachante (solo los suyos, sin
   *  firma emisor todavía). Paridad con la app: la web es padre. */
  async getConducesPorFirmar(): Promise<ConducePorFirmarRow[]> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_por_firmar');
    if (error) throw new Error(error.message);
    return (data ?? []) as ConducePorFirmarRow[];
  }

  /** AU1/AS2 — Conteo para el badge del menú "Por firmar". */
  async countConducesPorFirmar(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('mis_conduces_por_firmar_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** AU1/AS2 — El despachante firma DESDE SU sesión (anti-suplantación server-side).
   *  Devuelve 'firmado' | 'ya_firmado'. */
  async firmarComoDespachante(salidaId: string, firmaPath: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('conduce_firmar_despachante', {
      p_salida_id: salidaId,
      p_firma_path: firmaPath,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as string;
  }

  /** AV3 — "Recordarle al despachante": re-avisa al despachante que un conduce
   *  sigue esperando su firma (re-push manual). Devuelve el nombre del despachante,
   *  o null si ya firmó (nada que recordar). */
  async recordarDespachante(salidaId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.rpc('conduce_recordar_despachante', {
      p_salida_id: salidaId,
    });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  }

  /** AS3 — Contrato único del conduce (vista/PDF): despachante, labels, firma
   *  pendiente, items y firmas. Usado por la bandeja para el detalle antes de firmar. */
  async getConduceDetalleApp(salidaId: string): Promise<ConduceDetalleApp> {
    const { data, error } = await this.supabase.client.rpc('conduce_detalle_app', { p_salida_id: salidaId });
    if (error) throw new Error(error.message);
    return data as ConduceDetalleApp;
  }

  /** AU4 — adjunta items libres (material no catalogado) a un conduce y alerta al
   *  admin/inventario. Devuelve cuántos se agregaron. */
  async agregarItemsLibresConduce(
    salidaId: string,
    items: { nombre: string; cantidad: number; unidad: string | null }[],
  ): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('agregar_items_libres_conduce', {
      p_salida_id: salidaId,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return (data as number) ?? 0;
  }

  /** AU4 — bandeja de material no catalogado (pendientes de vínculo, o todos). */
  async getMaterialNoCatalogado(incluirResueltos = false): Promise<MaterialNoCatalogadoRow[]> {
    const { data, error } = await this.supabase.client.rpc('material_no_catalogado_pendientes', {
      p_incluir_resueltos: incluirResueltos,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as MaterialNoCatalogadoRow[];
  }

  /** AU4 — conteo de material no catalogado pendiente (badge). */
  async countMaterialNoCatalogado(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('material_no_catalogado_pendientes_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** AU4 — items libres (material no catalogado) de un conduce (para la vista/PDF). */
  async getItemsLibres(salidaId: string): Promise<ConduceItemLibre[]> {
    const { data, error } = await this.supabase.client
      .from('salida_items_libres')
      .select('id, nombre, cantidad, unidad, articulo_vinculado_id')
      .eq('salida_id', salidaId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConduceItemLibre[];
  }

  /** AU4/AY13 — vincula un item libre a un artículo. `generarMovimiento` (per-case,
   *  decisión Xaviel) genera además la salida real desde la bodega de origen. */
  async vincularItemLibre(itemLibreId: string, articuloId: string, generarMovimiento = false): Promise<void> {
    const { error } = await this.supabase.client.rpc('vincular_item_libre_articulo', {
      p_item_libre_id: itemLibreId,
      p_articulo_id: articuloId,
      p_generar_movimiento: generarMovimiento,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** AT11 — declina un item libre (no se creará el artículo) → historial + notifica al
   *  reportante. `sugeridoArticuloId` cuando el motivo es "ya existe" (apunta al correcto). */
  async declinarItemLibre(itemLibreId: string, motivo: string, sugeridoArticuloId: string | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('declinar_item_libre', {
      p_item_libre_id: itemLibreId,
      p_motivo: motivo,
      p_sugerido_articulo_id: sugeridoArticuloId,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  /** AT11 — revierte un declinado hecho por error (vuelve a la bandeja como pendiente). */
  async revertirDeclinacionItemLibre(itemLibreId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('revertir_declinacion_item_libre', {
      p_item_libre_id: itemLibreId,
    });
    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
  }

  // ── AY13 — "Conduces por implementar" (≥1 item libre sin vincular) ──────────
  async getConducesPorImplementar(): Promise<ConducePorImplementar[]> {
    const { data, error } = await this.supabase.client.rpc('conduces_por_implementar');
    if (error) throw new Error(error.message);
    return (data ?? []) as ConducePorImplementar[];
  }

  async countConducesPorImplementar(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('conduces_por_implementar_count');
    if (error) return 0;
    return (data as number) ?? 0;
  }

  /** Salidas awaiting confirmation for a given project (or all, for inventario/admin) — RLS scopes visibility. */
  async getDespachados(): Promise<SalidaInventario[]> {
    const { data, error } = await this.supabase.client
      .from('salidas_inventario')
      .select(SELECT_QUERY)
      .eq('estado', 'despachado')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SalidaInventario[];
  }

  /** Dual-party confirmation: records actual received quantity per line; auto-detects an incomplete delivery. */
  async confirmarRecepcion(
    salidaId: string,
    items: { detalle_id: string; cantidad_recibida: number }[],
    notas: string | null,
    fotoPath?: string | null,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('confirmar_recepcion_salida', {
      p_salida_id: salidaId,
      p_items: items,
      p_notas: notas,
      p_foto_path: fotoPath ?? null,
    });

    if (error) throw new Error(error.message);
    this.notificaciones.refresh();
    return data as boolean;
  }

  /** AY1 — sube la foto de evidencia de RECEPCIÓN (bucket privado `inventario`) y
   *  devuelve su path para pasarlo a confirmarRecepcion (no la enlaza aún). */
  async subirFotoRecepcion(salidaId: string, file: File): Promise<string> {
    const safe = (file.name || 'foto').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
    const path = `recepcion/${salidaId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.supabase.client.storage.from('inventario').upload(path, file);
    if (error) throw new Error(error.message);
    return path;
  }
}

/** AE5 — ruta/parada asociada a un conduce (salida). Devuelto por `conduce_ruta_info`. */
export interface ConduceRutaInfo {
  ruta_id: string;
  origen: string | null;
  destino: string | null;
  fecha: string | null;
  estado_ruta: string | null;
  tipo: string | null;
  ruta_parada_id: string | null;
  parada_ubicacion: string | null;
  parada_orden: number | null;
  parada_estado: string | null;
  parada_entregada_at: string | null;
  parada_entregado_a: string | null;
}

/** AU1/AS2 — fila de la bandeja "Conduces por firmar" (RPC mis_conduces_por_firmar). */
export interface ConducePorFirmarRow {
  id: string;
  fecha: string;
  proyecto_id: string | null;
  destino: string | null;
  bodega: string | null;
  estado: string;
  fase: string;
  created_at: string;
  /** AV1 — si el despachante actual (auth.uid) es elegible para firmar. Si es false,
   *  el conduce necesita corrección (reasignar despachante) y NO se ofrece el pad. */
  despachante_elegible: boolean;
}

/** AS3 — item de detalle del conduce (contrato conduce_detalle_app). */
export interface ConduceDetalleItem {
  detalle_id: string;
  articulo_id: string | null;
  articulo: string | null;
  codigo: string | null;
  unidad: string | null;
  propiedad: string | null;
  cantidad: number;
  cantidad_recibida: number | null;
}

/** AU4 — item libre (material no catalogado) que viaja en el conduce. */
export interface ConduceItemLibre {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  articulo_vinculado_id: string | null;
}

/** AY13 — conduce con items libres pendientes de vincular ("por implementar"). */
export interface ConducePorImplementar {
  salida_id: string;
  conduce_numero: string;
  fecha: string;
  estado: string;
  estado_label: string;
  proyecto: string | null;
  bodega: string | null;
  creado_por: string | null;
  pendientes: number;
  total_libres: number;
  es_prueba: boolean;
  created_at: string;
}

/** AU4 — fila de la bandeja de material no catalogado (RPC material_no_catalogado_pendientes). */
export interface MaterialNoCatalogadoRow {
  id: string;
  salida_id: string;
  conduce_numero: string;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  articulo_vinculado_id: string | null;
  articulo_vinculado: string | null;
  reportado_por: string | null;
  proyecto: string | null;
  created_at: string;
  vinculado_at: string | null;
  // AT11 — declinado (→ historial): quién, cuándo, motivo y artículo sugerido si "ya existe".
  declinado_at: string | null;
  declinado_por: string | null;
  declinar_motivo: string | null;
  sugerido_articulo: string | null;
}

/** AS3/AU4 — contrato único del conduce (vista/PDF). Campos usados por la web. */
export interface ConduceDetalleApp {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  estado_label: string;
  fase: string;
  fase_label: string;
  motivo: string | null;
  motivo_label: string | null;
  proyecto: string | null;
  bodega: string | null;
  destino_almacen: string | null;
  conductor: string | null;
  despachante: string | null;
  despachante_usuario_id: string | null;
  firma_despachante_pendiente: boolean;
  creado_por_nombre: string | null;
  entregado_por_nombre: string | null;
  observaciones: string | null;
  items: ConduceDetalleItem[];
  items_libres?: ConduceItemLibre[];
  firmas: { rol: string; nombre: string; firma_path: string | null; firmado_en: string }[];
  es_prueba: boolean;
}
