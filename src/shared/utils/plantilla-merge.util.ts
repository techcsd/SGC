// AZ1 — Resolver GENÉRICO de variables de plantillas de Legal.
// Mapea las variables ({{token}}) que el sistema YA conoce (empresa, empleado, obra,
// contexto) a sus valores reales, para que el paso de merge (renderizar) no muestre
// {{placeholders}} crudos. Lo que no se puede resolver queda vacío → la UI lo pide
// como pendiente (decisión AZ1: pedir los faltantes en el paso Firma).
//
// Es deliberadamente amplio (varios alias por dato) para servir a TODAS las plantillas,
// no solo al Contrato de Trabajo: nombre_empleado/nombre_contratista, obra/proyecto/
// lugar_trabajo, ciudad/lugar_firma, etc. Ver plantillas_documento.campos por plantilla.

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
  } | null;
  persona?: {
    nombre?: string | null;
    apellido?: string | null;
    documento_numero?: string | null;
    cargo?: string | null;
    telefono?: string | null;
  } | null;
  obra?: { nombre?: string | null; ubicacion?: string | null } | null;
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

  return out;
}
