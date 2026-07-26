// CSD-OPE-01 §6.8 / §9 — Checklists de Liberación (CL-01..07).
// Ciclo de firmas: Maestro (ejecutor) → Ing. Residente (inspecciona + mapea plano)
// → Ing. Responsable (autoriza) → Cliente + MIVHED. Regla de oro: ningún vaciado
// sin CL firmado (residente + responsable + cliente), reforzada por trigger en BD.

export type ClEstado = 'borrador' | 'firmado';

export type ClFirmaRol = 'maestro' | 'residente' | 'responsable' | 'cliente' | 'mivhed';

export interface ClPlantilla {
  id: string;
  codigo: string; // CL-01 … CL-07
  nombre: string;
  fase: string | null;
  descripcion: string | null;
  orden: number | null;
  activo: boolean;
}

export interface ClPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string | null;
  etiqueta: string;
  orden: number | null;
}

export interface ClRegistroItem {
  id?: string;
  registro_id?: string;
  etiqueta: string;
  seccion: string | null;
  cumple: boolean | null;
  comentario: string | null;
  orden: number | null;
}

export interface ClRegistroFoto {
  id?: string;
  registro_id?: string;
  storage_path: string;
  correcto: boolean | null;
  descripcion: string | null;
}

export type ClFirmaMetodo = 'pad' | 'foto';

export interface ClRegistroFirma {
  id?: string;
  registro_id?: string;
  rol: ClFirmaRol | string; // Z3 — en calidad de (rol de firma)
  usuario_id: string | null; // Z3 — quien realmente firmó (firmado_por)
  nombre: string | null;
  firma_path: string | null;
  // Q5 — origen de la firma: pad (trazo) | foto (imagen de la firma en papel).
  metodo?: ClFirmaMetodo | string | null;
  firmado_en?: string | null;
  orden: number | null;
  // Z3 — sustituibilidad: a quién sustituye el firmante (opcional, trazabilidad).
  en_sustitucion_de?: string | null;
  en_sustitucion_de_nombre?: string | null;
}

export interface ClRegistro {
  id: string;
  proyecto_id: string;
  plantilla_id: string;
  elemento_id: string | null;
  vaciado_id: string | null;
  bloque: string | null;
  eje: string | null;
  plano_path: string | null;
  estado: ClEstado | string;
  observaciones: string | null;
  creado_por: string | null;
  created_at?: string;
  updated_at?: string;
  // Embeds
  plantilla?: { codigo: string; nombre: string } | null;
  items?: ClRegistroItem[];
  fotos?: ClRegistroFoto[];
  firmas?: ClRegistroFirma[];
}

export interface ClRegistroFormData {
  plantilla_id: string;
  elemento_id: string | null;
  vaciado_id: string | null;
  bloque: string | null;
  eje: string | null;
  observaciones: string | null;
}

// Z3 — roles cuya firma LIBERA el checklist. Basta uno de estos (responsable
// O residente) para que la BD marque el CL como 'firmado'. Cliente/MIVHED
// siguen siendo opcionales (Q5).
export const CL_ROLES_LIBERAN: ClFirmaRol[] = ['residente', 'responsable'];

// Orden y etiqueta del ciclo de firmas del procedimiento.
// Z3 — la firma requerida es "responsable O residente" (uno basta); Cliente y
// MIVHED opcionales. El flag `obligatoria` marca los roles que liberan (chips).
// `foto: true` habilita subir una foto de la firma en papel además del trazo.
export const CL_FIRMA_ROLES: {
  value: ClFirmaRol;
  label: string;
  hint: string;
  obligatoria: boolean;
  foto?: boolean;
}[] = [
  { value: 'maestro', label: 'Maestro (ejecutor)', hint: 'Autoverifica y firma la ejecución', obligatoria: false },
  { value: 'residente', label: 'Ing. Residente', hint: 'Inspecciona con el checklist y mapea el plano', obligatoria: true },
  { value: 'responsable', label: 'Ing. Responsable', hint: 'Autoriza y firma la liberación', obligatoria: true },
  { value: 'cliente', label: 'Cliente (opcional)', hint: 'Da conformidad', obligatoria: false, foto: true },
  { value: 'mivhed', label: 'MIVHED (opcional)', hint: 'Visita de liberación (cuando aplica)', obligatoria: false, foto: true },
];

export const CL_ESTADOS: { value: ClEstado; label: string; badge: string }[] = [
  { value: 'borrador', label: 'Borrador', badge: 'warning' },
  { value: 'firmado', label: 'Firmado', badge: 'success' },
];
