import { Vehiculo } from '../models/vehiculo.model';

/**
 * Ronda DE (DE-01) — `alias · placa` solo no basta para identificar un
 * vehículo (Xaviel: "sometimes the user cant identify a vehicle only with
 * the plate number"). Formato completo: `alias · placa — marca modelo año ·
 * color · responsable`. Omite cualquier parte vacía sin dejar separadores
 * sueltos.
 */
export function displayVehiculoCompleto(v: Pick<Vehiculo, 'alias' | 'placa' | 'marca' | 'modelo' | 'anio' | 'color' | 'responsable'>): string {
  const cabeza = v.alias ? `${v.alias} · ${v.placa ?? 'sin placa'}` : (v.placa ?? 'sin placa');
  const specs = [v.marca, v.modelo, v.anio ? String(v.anio) : null].filter(Boolean).join(' ');
  const cola = [specs || null, v.color, v.responsable?.nombre].filter(Boolean).join(' · ');
  return cola ? `${cabeza} — ${cola}` : cabeza;
}

/** Normaliza texto (sin acentos, minúsculas) para búsqueda de vehículo tolerante. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Filtra vehículos por placa, alias, marca, modelo, chasis o responsable (DE-01). */
export function filtrarVehiculos<T extends Pick<Vehiculo, 'alias' | 'placa' | 'marca' | 'modelo' | 'vin' | 'responsable'>>(
  vehiculos: T[],
  texto: string,
): T[] {
  const q = normalizar(texto.trim());
  if (!q) return vehiculos;
  return vehiculos.filter((v) => {
    const campos = [v.placa, v.alias, v.marca, v.modelo, v.vin, v.responsable?.nombre].filter(Boolean) as string[];
    return campos.some((c) => normalizar(c).includes(q));
  });
}
