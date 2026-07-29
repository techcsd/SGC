// Combustible v2 — galones + monto (RD$) con derivados calculados en servidor
// por el RPC `registrar_combustible_app`. Las columnas litros/costo_por_litro
// quedan legacy (registros históricos previos a v2).

export interface RegistroCombustible {
  id: string;
  vehiculo_id: string;
  vehiculo?: { placa: string; marca: string };
  conductor_id: string | null;
  conductor?: { nombre: string };
  fecha: string;
  kilometraje: number | null;
  estacion: string | null;
  // Z23-app — producto/tarjeta para conciliar con el reporte del proveedor.
  producto: string | null;
  // AA20 — subtipo regular|premium (con producto → producto canónico para precios).
  subtipo: string | null;
  tarjeta: string | null;
  // Z23.4 — titular de la tarjeta cuando es de una persona (no del vehículo).
  titular?: string | null;
  titular_es_persona?: boolean;
  notas: string | null;

  // ── v2: galones / monto + derivados ──
  galones: number | null;
  monto: number | null;
  precio_por_galon: number | null;
  km_anterior: number | null;
  km_recorridos: number | null;
  rendimiento_km_gal: number | null;
  costo_por_km: number | null;
  foto_recibo_path: string | null;
  foto_tablero_path: string | null;
  // Y4 — 3ª foto: bomba/estación en 0 (app móvil). Aditivo/retrocompatible.
  foto_bomba_path: string | null;
  alerta_consumo: boolean;
  // U10 — motivo legible del disparo de la alerta (esperado / propio / piso absoluto).
  motivo_alerta: string | null;
  client_uuid: string | null;

  // ── Legacy (litros) ──
  litros: number | null;
  costo_por_litro: number | null;
  total: number | null;

  // T2 — dato de prueba (solo admin lo ve/gestiona; oculto por RLS a no-admin).
  es_prueba?: boolean;

  created_at: string;
}

/** Datos que digita el usuario (los derivados los calcula el RPC). */
export interface RegistroCombustibleFormData {
  vehiculo_id: string;
  conductor_id: string | null;
  fecha: string;
  kilometraje: number;
  galones: number;
  monto: number;
  estacion: string | null;
  notas: string | null;
  // Z23.4 — datos para conciliar con el reporte del proveedor (opcionales).
  producto: string | null;              // 'diesel' | 'gasolina'
  subtipo: string | null;               // AA20 — 'regular' | 'premium'
  tarjeta: string | null;               // número/identificador de tarjeta
  titular: string | null;               // titular si la tarjeta es de una persona
  titular_es_persona: boolean;          // true → la tarjeta pertenece a una persona
}

/** AA20 — precio oficial vigente por producto canónico (widget/referencia). */
export interface PrecioCombustibleVigente {
  producto: string;   // gasolina_regular | gasolina_premium | diesel_regular | diesel_premium
  precio: number;     // RD$/galón
  vigencia_desde: string;
  fuente: string;
}

/** AA20 — etiqueta legible de un producto canónico. */
export const PRODUCTO_CANONICO_LABEL: Record<string, string> = {
  gasolina_regular: 'Gasolina Regular',
  gasolina_premium: 'Gasolina Premium',
  diesel_regular: 'Diésel Regular',
  diesel_premium: 'Diésel Óptimo',
};

/** AA20 — producto canónico a partir de producto (gasolina|diesel) + subtipo. */
export function productoCanonico(producto: string | null, subtipo: string | null): string | null {
  if (!producto) return null;
  return subtipo ? `${producto}_${subtipo}` : producto;
}

/** jsonb que devuelve el RPC `registrar_combustible_app`. */
export interface CombustibleDerivados {
  id: string;
  precio_por_galon: number | null;
  km_anterior: number | null;
  km_recorridos: number | null;
  rendimiento_km_gal: number | null;
  costo_por_km: number | null;
  alerta_consumo: boolean;
  promedio_rendimiento: number | null;
  /** T5 — referencias de la evaluación en cascada. */
  rendimiento_esperado?: number | null;
  promedio_flota?: number | null;
  /** U10 — 'piso' se agrega como tercer nivel (piso absoluto de coherencia). */
  referencia_alerta?: 'esperado' | 'propio' | 'piso' | null;
  /** U10 — motivo legible del disparo (mostrado en el análisis). */
  motivo_alerta?: string | null;
}

/** Un registro es v2 si tiene galones (aunque falten los derivados). */
export function esRegistroV2(r: RegistroCombustible): boolean {
  return r.galones != null;
}
