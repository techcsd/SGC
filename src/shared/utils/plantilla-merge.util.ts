// AZ1 — Resolver GENÉRICO de variables de plantillas de Legal.
// Mapea las variables ({{token}}) que el sistema YA conoce (empresa, empleado, obra,
// contexto) a sus valores reales, para que el paso de merge (renderizar) no muestre
// {{placeholders}} crudos. Lo que no se puede resolver queda vacío → la UI lo pide
// como pendiente (decisión AZ1: pedir los faltantes en el paso Firma).
//
// Es deliberadamente amplio (varios alias por dato) para servir a TODAS las plantillas,
// no solo al Contrato de Trabajo: nombre_empleado/nombre_contratista, obra/proyecto/
// lugar_trabajo, ciudad/lugar_firma, etc. Ver plantillas_documento.campos por plantilla.

import { numeroALetras, fechaEnLetras } from './numero-a-letras.util';

/** Contexto disponible al resolver (todo opcional; lo que falte queda pendiente). */
export interface MergeContext {
  empresa?: {
    razon_social?: string | null;
    nombre_comercial?: string | null;
    rnc?: string | null;
    representante?: string | null;
    ciudad?: string | null;
    direccion?: string | null;
    telefono?: string | null;
    gerente_general?: string | null; // CF7
  } | null;
  persona?: {
    nombre?: string | null;
    apellido?: string | null;
    documento_numero?: string | null;
    cargo?: string | null;
    telefono?: string | null;
    nacionalidad?: string | null;   // CF7
    domicilio?: string | null;      // CF7
    tarifa_hora?: number | null;    // CF7
  } | null;
  obra?: { nombre?: string | null; ubicacion?: string | null; cliente?: string | null } | null;
  /** Fecha ISO (yyyy-mm-dd) a usar para fecha/fecha_firma. */
  hoyIso?: string;
}

function nombreCompleto(p?: MergeContext['persona']): string {
  if (!p) return '';
  return `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();
}

/**
 * Construye el diccionario de valores AUTO-resueltos (clave → valor) a partir del
 * contexto. Solo incluye claves con valor real; las ausentes se dejan fuera para que
 * el llamador sepa cuáles siguen pendientes. Las claves de fecha se dejan en ISO: el
 * motor `renderizar` las formatea a fecha larga es-DO cuando el campo es tipo 'fecha'.
 */
export function construirValoresAuto(ctx: MergeContext): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, val: string | null | undefined) => {
    const v = (val ?? '').toString().trim();
    if (v) out[key] = v;
  };

  const emp = ctx.empresa;
  const razon = emp?.razon_social || emp?.nombre_comercial || 'Constructora S&D';
  // Empresa
  set('empresa', razon);
  set('razon_social', emp?.razon_social);
  set('rnc_empresa', emp?.rnc);
  set('rnc', emp?.rnc);
  set('representante_empresa', emp?.representante);
  set('representante', emp?.representante);
  set('ciudad', emp?.ciudad);
  set('lugar_firma', emp?.ciudad);
  set('direccion_empresa', emp?.direccion);

  // Empleado / persona de la ficha
  const nom = nombreCompleto(ctx.persona);
  set('nombre_empleado', nom);
  set('nombre_contratista', nom);
  set('cedula_empleado', ctx.persona?.documento_numero);
  set('id_contratista', ctx.persona?.documento_numero);
  set('no_documento', ctx.persona?.documento_numero);
  set('cargo', ctx.persona?.cargo);

  // Obra / proyecto
  const obra = ctx.obra?.nombre;
  set('lugar_trabajo', obra);
  set('obra', obra);
  set('proyecto', obra);
  set('proyecto_nombre', obra);
  set('ubicacion', ctx.obra?.ubicacion);
  set('ubicacion_proyecto', ctx.obra?.ubicacion);

  // Fechas de contexto
  const hoy = ctx.hoyIso;
  set('fecha_firma', hoy);
  set('fecha', hoy);

  // ── CF7 — claves del asistente de espacios del Word de Sonia ────────────────
  set('empresa_razon_social', emp?.razon_social || razon);
  set('empresa_rnc', emp?.rnc);
  set('empresa_domicilio', emp?.direccion);
  set('empresa_ciudad', emp?.ciudad);
  set('empresa_gerente_general', emp?.gerente_general);
  set('empresa_representante', emp?.representante);
  set('trabajador_nombre', nom);
  set('trabajador_documento', ctx.persona?.documento_numero);
  set('trabajador_nacionalidad', ctx.persona?.nacionalidad);
  set('trabajador_domicilio', ctx.persona?.domicilio);
  set('trabajador_cargo', ctx.persona?.cargo);
  const tarifa = ctx.persona?.tarifa_hora;
  if (tarifa != null && Number.isFinite(tarifa)) {
    set('trabajador_tarifa_hora', String(tarifa));
    set('trabajador_tarifa_hora_letras', numeroALetras(tarifa, true));
  }
  set('obra_cliente', ctx.obra?.cliente);
  set('obra_nombre', obra);
  if (hoy) set('fecha_letras', fechaEnLetras(hoy));

  return out;
}
