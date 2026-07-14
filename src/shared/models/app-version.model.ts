export type Plataforma = 'web' | 'movil';

/** Etiqueta de cambio (estilo "Keep a Changelog"). */
export type CambioTag = 'nuevo' | 'mejora' | 'arreglo' | 'seguridad';

export interface CambioItem {
  t: CambioTag | string;
  d: string;
}

export const CAMBIO_META: Record<string, { label: string; badge: string }> = {
  nuevo: { label: 'Nuevo', badge: 'success' },
  mejora: { label: 'Mejora', badge: 'info' },
  arreglo: { label: 'Arreglo', badge: 'warning' },
  seguridad: { label: 'Seguridad', badge: 'purple' },
};

/** Versión de la app (móvil o web) — rollout por etapas (R15) + historial/timeline. */
export interface AppVersion {
  id: string;
  version: string;
  plataforma: Plataforma;
  fecha: string | null;
  titulo: string | null;
  cambios: CambioItem[];
  url: string | null;
  notas: string | null;
  apk_url: string | null;
  publicada: boolean;
  minima: boolean;
  created_at: string;
  publicada_at: string | null;
  publicada_por: string | null;
}

export interface AppVersionFormData {
  version: string;
  notas: string | null;
  apk_url: string | null;
  publicada: boolean;
  minima: boolean;
}

/** Resultado del RPC público sgc.version_publicada(). */
export interface VersionPublicada {
  version_publicada: string | null;
  notas: string | null;
  apk_url: string | null;
  version_minima: string | null;
}
