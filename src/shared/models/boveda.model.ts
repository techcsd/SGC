// CZ3/CZ9 — Vault ("Bóveda") de Administración. Metadata SOLO (nunca el valor
// cifrado — las columnas secretas están reveocadas a `authenticated`, se leen
// únicamente a través de la edge `boveda`).

export type BovedaTipo = 'cuenta' | 'api' | '2fa' | 'nota' | 'archivo';

export interface BovedaEntrada {
  id: string;
  tipo: BovedaTipo;
  nombre: string;
  sitio_url: string | null;
  usuario_texto: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  etiquetas: string[];
  rotar_cada_dias: number | null;
  ultima_rotacion: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export type BovedaEstadoRotacion = 'al_dia' | 'por_rotar' | 'vencida' | 'sin_rotacion';

export interface BovedaAcceso {
  id: string;
  usuario_id: string;
  entrada_id: string | null;
  accion: string;
  detalle: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}
