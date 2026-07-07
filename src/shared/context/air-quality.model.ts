// Provider-independent air-quality domain shapes. Mirrors weather.model.ts so any
// AirQualityProvider maps its raw payload into these — the app never depends on a
// specific air-quality API.

export interface CalidadAire {
  capturadoEn: string;
  usAqi: number | null;
  europeanAqi: number | null;
  pm25: number | null; // μg/m³
  pm10: number | null; // μg/m³
  ozono: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  polvo: number | null; // dust μg/m³ — relevant on construction sites
}

export type AqiNivel = 'buena' | 'moderada' | 'sensibles' | 'dañina' | 'muy_dañina' | 'peligrosa';

export interface AqiInfo {
  nivel: AqiNivel;
  label: string;
  color: string;
}

/** US AQI band interpretation (label + color) — the widely understood scale. */
export function interpretarAqi(usAqi: number | null): AqiInfo {
  if (usAqi == null) return { nivel: 'buena', label: 'Sin datos', color: '#94a3b8' };
  if (usAqi <= 50) return { nivel: 'buena', label: 'Buena', color: '#2D7D46' };
  if (usAqi <= 100) return { nivel: 'moderada', label: 'Moderada', color: '#B45309' };
  if (usAqi <= 150) return { nivel: 'sensibles', label: 'Dañina para grupos sensibles', color: '#EA580C' };
  if (usAqi <= 200) return { nivel: 'dañina', label: 'Dañina a la salud', color: '#C0392B' };
  if (usAqi <= 300) return { nivel: 'muy_dañina', label: 'Muy dañina', color: '#7E22CE' };
  return { nivel: 'peligrosa', label: 'Peligrosa', color: '#7F1D1D' };
}
