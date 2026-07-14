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
  alerta_consumo: boolean;
  client_uuid: string | null;

  // ── Legacy (litros) ──
  litros: number | null;
  costo_por_litro: number | null;
  total: number | null;

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
}

/** Un registro es v2 si tiene galones (aunque falten los derivados). */
export function esRegistroV2(r: RegistroCombustible): boolean {
  return r.galones != null;
}
