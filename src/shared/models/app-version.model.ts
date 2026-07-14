/** Versión de la app móvil publicada por etapas (R15, staged rollout). */
export interface AppVersion {
  id: string;
  version: string;
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
