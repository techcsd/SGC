// Y6 — Reporte de error/crash enviado por la app (telemetría propia).

export type AppErrorType = 'crash' | 'error' | 'camera' | 'sync' | 'permission' | 'other';

export interface AppErrorReport {
  id: string;
  user_id: string | null;
  device_model: string | null;
  device_brand: string | null;
  os_version: string | null;
  app_version: string | null;
  platform: string | null;
  error_type: AppErrorType;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  source?: 'app' | 'web';
  created_at: string;
}

/** Fila del RPC de agrupación por firma de mensaje. */
export interface AppErrorGrupo {
  firma: string;
  error_type: AppErrorType;
  source?: 'app' | 'web';
  ocurrencias: number;
  dispositivos: number;
  primera_vez: string;
  ultima_vez: string;
  ejemplo_message: string;
}

export interface AppErrorFiltros {
  errorType?: AppErrorType | null;
  deviceModel?: string | null;
  deviceBrand?: string | null;
  appVersion?: string | null;
  source?: 'app' | 'web' | null;
  desde?: string | null; // ISO date (inicio de día)
  hasta?: string | null; // ISO date (fin de día)
}

export const APP_ERROR_TYPES: { value: AppErrorType; label: string }[] = [
  { value: 'crash', label: 'Crash' },
  { value: 'error', label: 'Error' },
  { value: 'camera', label: 'Cámara' },
  { value: 'sync', label: 'Sincronización' },
  { value: 'permission', label: 'Permisos' },
  { value: 'other', label: 'Otro' },
];
