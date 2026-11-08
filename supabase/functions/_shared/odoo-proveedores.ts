// _shared/odoo-proveedores.ts — proveedores DIRECTO en Odoo (res.partner con supplier_rank > 0).
// Contiene el mapeo compartido por las lecturas (`proveedorDesdeFila`) y los adaptadores de
// ESCRITURA (crear / actualizar), con el mismo patrón mock/real que _shared/odoo-oc.ts:
//  - MOCK: no toca Odoo; es el valor por defecto y lo que usan los tests.
//  - REAL: res.partner vía `OdooClient.call` (create/write; nunca reintenta, ver odoo-client.ts).
// SGC no guarda nada aquí: lo operativo del proveedor lo gestiona el cliente con sus RPC propias.
import { type OdooClient, OdooError } from "./odoo-client.ts";
import { idDeterminista, sanearFault } from "./odoo-oc.ts";

type Fila = Record<string, unknown>;

export const CAMPOS_PROVEEDOR = ["id", "name", "vat", "email", "phone", "street", "city", "active", "is_company", "supplier_rank"];
/** Sin esto Odoo oculta los archivados: un proveedor desactivado devolvería "no existe". */
const CONTEXTO_TODOS = { active_test: false };
const MAX_CANDIDATOS_RNC = 20;

export interface Proveedor {
  id: number;
  nombre: string;
  rnc: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  es_empresa: boolean;
}

// Odoo devuelve `false` (no null) en los campos vacíos.
const texto = (v: unknown): string | null => (v ? String(v) : null);

export function proveedorDesdeFila(f: Fila): Proveedor {
  // Solo `street`: es lo único que la pantalla escribe de vuelta; con la ciudad incluida, editar duplicaría la ciudad.
  const direccion = texto(f.street) ?? "";
  return {
    id: f.id as number,
    nombre: String(f.name ?? ""),
    rnc: texto(f.vat),
    email: texto(f.email),
    telefono: texto(f.phone),
    direccion: direccion || null,
    activo: !!f.active,
    es_empresa: !!f.is_company,
  };
}

/** Mismo filtro de compañía que el resto del gateway: partners sin compañía o de la nuestra. */
export const dominioCompaniaPartner = (cid: number) => ["|", ["company_id", "=", false], ["company_id", "=", cid]];

/** Lee partners por ids (incluye archivados). El que no exista simplemente no aparece. */
export async function leerFilasProveedores(odoo: OdooClient, ids: number[]): Promise<Fila[]> {
  return await odoo.call("res.partner", "search_read", [
    [["id", "in", ids], ...dominioCompaniaPartner(odoo.companyId)],
  ], { fields: CAMPOS_PROVEEDOR, limit: ids.length, context: CONTEXTO_TODOS }) as Fila[];
}

export async function leerProveedores(odoo: OdooClient, ids: number[]): Promise<Proveedor[]> {
  return (await leerFilasProveedores(odoo, ids)).map(proveedorDesdeFila);
}

// ── Contrato de los adaptadores (params ya normalizados por acciones-escritura.ts) ──
export interface ProveedorNuevo { nombre: string; rnc?: string; email?: string; telefono?: string; direccion?: string }
/** `null` = vaciar el campo en Odoo; `undefined` = no tocarlo. */
export interface ProveedorCambios {
  proveedor_id: number; nombre?: string; rnc?: string | null; email?: string | null;
  telefono?: string | null; direccion?: string | null; activo?: boolean;
}
export interface ResultadoProveedorCrear { proveedor: Proveedor; ya_existia: boolean; nota?: string }
export interface ResultadoProveedorActualizar { proveedor: Proveedor; nota?: string }
export interface AdaptadoresProveedores {
  proveedorCrear: (p: ProveedorNuevo) => Promise<ResultadoProveedorCrear>;
  proveedorActualizar: (p: ProveedorCambios) => Promise<ResultadoProveedorActualizar>;
}

/** Rechazo de negocio (mensaje apto para el usuario): el gateway lo devuelve como 400. */
export class ProveedorError extends Error {}

const NOTA_MOCK = "MOCK -- no se llamó a Odoo real (D-08)";

// ── MOCK ────────────────────────────────────────────────────────────────────
export const proveedorCrearMock: AdaptadoresProveedores["proveedorCrear"] = (p) =>
  Promise.resolve({
    proveedor: {
      id: idDeterminista(p.rnc ?? p.nombre), nombre: p.nombre, rnc: p.rnc ?? null, email: p.email ?? null,
      telefono: p.telefono ?? null, direccion: p.direccion ?? null, activo: true, es_empresa: p.rnc?.length === 9,
    },
    ya_existia: false,
    nota: NOTA_MOCK,
  });

export const proveedorActualizarMock: AdaptadoresProveedores["proveedorActualizar"] = (p) =>
  Promise.resolve({
    proveedor: {
      id: p.proveedor_id, nombre: p.nombre ?? `Proveedor ${p.proveedor_id}`, rnc: p.rnc ?? null, email: p.email ?? null,
      telefono: p.telefono ?? null, direccion: p.direccion ?? null, activo: p.activo ?? true, es_empresa: p.rnc?.length === 9,
    },
    nota: NOTA_MOCK,
  });

// ── REAL ────────────────────────────────────────────────────────────────────
/** Un fault de Odoo (rechazo cierto, transacción revertida) pasa a error de negocio saneado; timeouts/caídas se relanzan. */
async function conRechazo<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OdooError && e.codigo === "odoo_error" && e.fault) {
      console.error(`[odoo-proveedores] rechazo de Odoo: ${e.message}`); // el texto crudo solo queda en el log
      throw new ProveedorError(sanearFault(e.message));
    }
    throw e;
  }
}

/** campo SGC -> campo res.partner. `null` se escribe como `false` (así vacía Odoo un campo). */
const CAMPOS_ESCRITURA = [["nombre", "name"], ["rnc", "vat"], ["email", "email"], ["telefono", "phone"], ["direccion", "street"]] as const;

function valoresOdoo(p: Partial<ProveedorCambios>): Record<string, unknown> {
  const vals: Record<string, unknown> = {};
  for (const [k, campo] of CAMPOS_ESCRITURA) if (p[k] !== undefined) vals[campo] = p[k] ?? false;
  if (p.activo !== undefined) vals.active = p.activo;
  return vals;
}

const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Partner con ese RNC (incluye archivados). Odoo guarda el vat con formato libre: se compara por dígitos. */
async function buscarPorRnc(odoo: OdooClient, rnc: string): Promise<Fila | null> {
  // Los comodines entre dígitos tolera "131-12345-6"; la verificación posterior exige igualdad exacta de dígitos.
  const filas = await odoo.call("res.partner", "search_read", [
    [["vat", "=ilike", `%${rnc.split("").join("%")}%`], ...dominioCompaniaPartner(odoo.companyId)],
  ], { fields: CAMPOS_PROVEEDOR, limit: MAX_CANDIDATOS_RNC, context: CONTEXTO_TODOS }) as Fila[];
  return filas.find((f) => soloDigitos(f.vat) === rnc) ?? null;
}

/** Crea el proveedor. Idempotente por RNC: si ya existe uno, devuelve ese sin crear. */
export function proveedorCrearReal(odoo: () => OdooClient): AdaptadoresProveedores["proveedorCrear"] {
  return (p) => conRechazo(async () => {
    const c = odoo();
    if (p.rnc) {
      const existente = await buscarPorRnc(c, p.rnc);
      if (existente) {
        // Un partner que era solo cliente no saldría en la lista de proveedores: se le marca como proveedor.
        if (Number(existente.supplier_rank ?? 0) <= 0) await c.call("res.partner", "write", [[existente.id], { supplier_rank: 1 }]);
        return { proveedor: proveedorDesdeFila(existente), ya_existia: true };
      }
    }
    const vals = {
      ...valoresOdoo(p), supplier_rank: 1, company_id: c.companyId,
      ...(p.rnc?.length === 9 ? { is_company: true } : {}),
    };
    const id = await c.call("res.partner", "create", [vals]);
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new OdooError("odoo_no_disponible", "Odoo no devolvió el id del registro creado: no se sabe si se aplicó.");
    }
    const [creado] = await leerProveedores(c, [id]);
    // Si la relectura falla ya sabemos el id: se devuelve lo enviado en vez de inventar un error.
    return { proveedor: creado ?? proveedorDesdeFila({ id, active: true, ...vals }), ya_existia: false };
  });
}

/** Edita/archiva el proveedor. Lee antes: un id inexistente da error claro en vez de un write vacío. */
export function proveedorActualizarReal(odoo: () => OdooClient): AdaptadoresProveedores["proveedorActualizar"] {
  return (p) => conRechazo(async () => {
    const c = odoo();
    const [actual] = await leerProveedores(c, [p.proveedor_id]);
    if (!actual) throw new ProveedorError("El proveedor no existe en Odoo.");
    await c.call("res.partner", "write", [[p.proveedor_id], valoresOdoo(p)]);
    const [despues] = await leerProveedores(c, [p.proveedor_id]);
    if (!despues) throw new OdooError("odoo_no_disponible", "Odoo no devolvió el proveedor tras guardar: reintenta para confirmar.");
    return { proveedor: despues };
  });
}

export function crearAdaptadoresProveedoresReales(odoo: () => OdooClient): AdaptadoresProveedores {
  return { proveedorCrear: proveedorCrearReal(odoo), proveedorActualizar: proveedorActualizarReal(odoo) };
}

/** Misma regla que OC: REAL solo con ODOO_ESCRITURA_HABILITADA=true (ver escrituraOdooHabilitada). */
export function seleccionarAdaptadoresProveedores(habilitada: boolean, odoo: () => OdooClient): AdaptadoresProveedores {
  return habilitada
    ? crearAdaptadoresProveedoresReales(odoo)
    : { proveedorCrear: proveedorCrearMock, proveedorActualizar: proveedorActualizarMock };
}
