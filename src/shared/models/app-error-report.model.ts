// Y6 — Reporte de error/crash enviado por la app (telemetría propia).

// BI4 — homologado con la whitelist del servidor (report_app_error).
export type AppErrorType =
  | 'crash' | 'error' | 'camera' | 'sync' | 'permission' | 'other'
  | 'tracking' | 'login' | 'gps' | 'voice';

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

// AW14 — estado del workflow de atención por firma de error.
export type AppErrorEstado = 'abierto' | 'en_revision' | 'solucionado';

export const APP_ERROR_ESTADOS: { value: AppErrorEstado; label: string }[] = [
  { value: 'abierto', label: 'Abierto' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'solucionado', label: 'Solucionado' },
];

/** Fila del RPC de agrupación por firma de mensaje. */
export interface AppErrorGrupo {
  firma: string;
  error_type: AppErrorType;
  source?: 'app' | 'web';
  ocurrencias: number;
  dispositivos: number;
  usuarios: number; // AW14 — usuarios distintos afectados
  primera_vez: string;
  ultima_vez: string;
  ejemplo_message: string;
  ejemplo_id?: string; // BI4 — un id de ocurrencia de ejemplo (para crear issue por grupo)
  // AW14 — workflow
  estado: AppErrorEstado;
  nota: string | null;
  resuelto_por_nombre: string | null;
  resuelto_at: string | null;
  reabierto_at: string | null;
  resuelto_en_version?: string | null; // BI4 — versión en que se cerró
  ocurrencias_cliente_viejo?: number; // BI4 — ocurrencias de clientes < versión de cierre
}

/** AW14 — ocurrencia individual de una firma (detalle + metadata + usuario). */
export interface AppErrorOcurrencia {
  id: string;
  created_at: string;
  error_type: AppErrorType;
  source?: 'app' | 'web';
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
  user_id: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  device_model: string | null;
  device_brand: string | null;
  os_version: string | null;
  app_version: string | null;
  platform: string | null;
}

export interface AppErrorFiltros {
  errorType?: AppErrorType | null;
  deviceModel?: string | null;
  deviceBrand?: string | null;
  appVersion?: string | null;
  source?: 'app' | 'web' | null;
  desde?: string | null; // ISO date (inicio de día)
  hasta?: string | null; // ISO date (fin de día)
  // AW14 — 'abiertos' (todo lo no resuelto) | 'solucionado' (Historial) | estado exacto
  estado?: 'abiertos' | AppErrorEstado | null;
}

export const APP_ERROR_TYPES: { value: AppErrorType; label: string }[] = [
  { value: 'crash', label: 'Crash' },
  { value: 'error', label: 'Error' },
  { value: 'camera', label: 'Cámara' },
  { value: 'sync', label: 'Sincronización' },
  { value: 'permission', label: 'Permisos' },
  { value: 'tracking', label: 'Rastreo' },
  { value: 'login', label: 'Inicio de sesión' },
  { value: 'gps', label: 'GPS' },
  { value: 'voice', label: 'Voz' },
  { value: 'other', label: 'Otro' },
];
