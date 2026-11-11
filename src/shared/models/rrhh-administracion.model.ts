// DN-29 (ronda DN) — Administración de la empresa (RRHH › Administración).
export type TramiteTipo = 'permiso' | 'licencia' | 'seguro' | 'impuesto' | 'otro';
export type TramiteEstado = 'vigente' | 'vencido' | 'en_tramite';

export interface RrhhTramite {
  id: string;
  nombre: string;
  tipo: TramiteTipo;
  entidad_responsable: string | null;
  numero_referencia: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  archivo_path: string | null;
  estado: TramiteEstado;
  notas: string | null;
  creado_por: string | null;
  es_prueba: boolean;
  created_at: string;
  updated_at: string;
}
