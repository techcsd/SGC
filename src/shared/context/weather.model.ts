// Domain weather models — provider-independent. Any WeatherProvider maps its
// raw payload into these so the rest of the app never knows which API is behind.

export interface Coordenadas {
  latitud: number;
  longitud: number;
}

export interface WeatherActual {
  capturadoEn: string;
  temperatura: number | null;
  sensacion: number | null;
  humedad: number | null;
  vientoKmh: number | null;
  vientoDir: number | null;
  precipitacionMm: number | null;
  probPrecipitacion: number | null;
  nubosidad: number | null;
  uv: number | null;
  visibilidadKm: number | null;
  codigoTiempo: number | null;
  crudo?: unknown;
}

export interface WeatherHora {
  hora: string;
  temperatura: number | null;
  probPrecipitacion: number | null;
  codigoTiempo: number | null;
}

export interface WeatherDia {
  fecha: string;
  tempMax: number | null;
  tempMin: number | null;
  probPrecipitacionMax: number | null;
  precipitacionMm: number | null;
  vientoMaxKmh: number | null;
  uvMax: number | null;
  codigoTiempo: number | null;
}

export interface WeatherPronostico {
  actual: WeatherActual;
  porHora: WeatherHora[];
  porDia: WeatherDia[];
}

export type RiesgoNivel = 'info' | 'precaucion' | 'peligro';

export interface Recomendacion {
  nivel: RiesgoNivel;
  icono: string;
  titulo: string;
  detalle: string;
}

/** WMO weather-code interpretation (label + emoji + whether it implies rain). */
export function interpretarCodigoTiempo(code: number | null): { label: string; icono: string; lluvia: boolean } {
  if (code == null) return { label: 'Desconocido', icono: '❓', lluvia: false };
  if (code === 0) return { label: 'Despejado', icono: '☀️', lluvia: false };
  if (code <= 3) return { label: 'Parcialmente nublado', icono: '⛅', lluvia: false };
  if (code === 45 || code === 48) return { label: 'Neblina', icono: '🌫️', lluvia: false };
  if (code >= 51 && code <= 57) return { label: 'Llovizna', icono: '🌦️', lluvia: true };
  if (code >= 61 && code <= 67) return { label: 'Lluvia', icono: '🌧️', lluvia: true };
  if (code >= 71 && code <= 77) return { label: 'Nieve', icono: '🌨️', lluvia: true };
  if (code >= 80 && code <= 82) return { label: 'Aguaceros', icono: '🌧️', lluvia: true };
  if (code >= 85 && code <= 86) return { label: 'Chubascos de nieve', icono: '🌨️', lluvia: true };
  if (code >= 95) return { label: 'Tormenta eléctrica', icono: '⛈️', lluvia: true };
  return { label: 'Nublado', icono: '☁️', lluvia: false };
}
