/** DM1 — una skill de la biblioteca del módulo Claude. */
export interface ClaudeSkill {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string;
  tipo: 'skill' | 'instrucciones' | 'plantilla' | 'documento';
  ambito: 'personal' | 'rol' | 'empresa';
  estado: 'borrador' | 'propuesta' | 'publicada' | 'archivada' | 'requiere_revision';
  roles: string[];
  tags: string[];
  owner_id: string;
  version_actual: number;
  tiene_codigo_ejecutable: boolean;
  motivo_devuelta: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaudePack {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  tipo: 'setup' | 'rol' | 'personalizado';
  rol: string | null;
}

export interface ClaudeProgreso {
  usuario_id: string;
  conecto_sgc: boolean;
  descargo_setup: boolean;
  subio_primera_skill: boolean;
  probo_pregunta: boolean;
}

export interface ClaudeEncuestaRespuesta {
  usuario_id: string;
  rol_snapshot: string | null;
  usa_hoy: string | null;
  tareas: string | null;
  tarea_repetida: string | null;
  que_frena: string | null;
  documento_semanal: string | null;
  que_deberia_hacer: string | null;
}

export interface ClaudeOrgInfo {
  id: number;
  plan: string | null;
  asientos_totales: number | null;
  asientos_ocupados: number | null;
  owners: string[];
  conectores: string[];
  skills_organizacion: { nombre: string; autor: string; version: number; visibilidad: string; candidata_publicar_rol: string }[];
  notas: string | null;
  actualizado_en: string;
}
