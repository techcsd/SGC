// _shared/odoo-maestros.ts -- DS: publicacion de MAESTROS (articulo, categoria, unidad, proveedor) sin simulador.
// Odoo es la autoridad del catalogo: SGC no crea ni modifica maestros en Odoo desde el outbox. El evento se completa
// VERIFICANDO que el vinculo (odoo_id) apunta a un registro vivo en el Odoo real. Sin vinculo o con vinculo roto -> error visible
// (se corrige en Tecnologia > Homologacion con Odoo), nunca un exito falso.
import type { EventoOutbox, ResultadoPublicacion } from "./odoo-inventario.ts";

export const MODELO_MAESTRO: Record<string, string> = {
  articulo: "product.product",
  categoria_inventario: "product.category",
  unidad: "uom.uom",
  proveedor: "res.partner",
};

export interface DatosMaestro { odooId: number | null; nombre: string | null; esPrueba: boolean }
export interface DepsMaestro {
  cargar: (tipo: string, id: string) => Promise<DatosMaestro | null>;
  /** true si el registro existe (activo o archivado) en Odoo. */
  existe: (modelo: string, odooId: number) => Promise<boolean>;
}

export async function verificarMaestro(deps: DepsMaestro, evento: EventoOutbox): Promise<ResultadoPublicacion> {
  const modelo = MODELO_MAESTRO[evento.agregado_tipo];
  if (!modelo) return { estado: "error", error: `Tipo de maestro sin modelo Odoo: ${evento.agregado_tipo}` };
  const m = await deps.cargar(evento.agregado_tipo, evento.agregado_id);
  if (!m) return { estado: "completado", resultado: { omitido: "ya_no_existe" } };
  if (m.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
  if (m.odooId == null) return { estado: "error", error: `«${m.nombre ?? evento.agregado_id}» no está vinculado con Odoo: homológalo en Tecnología › Homologación con Odoo.` };
  let existe: boolean;
  try { existe = await deps.existe(modelo, m.odooId); } catch { return { estado: "reintento", error: "Odoo no respondió al verificar el vínculo.", reintentarEnMs: 300_000 }; }
  if (!existe) return { estado: "error", error: `El vínculo de «${m.nombre ?? evento.agregado_id}» apunta a un registro que ya no existe en Odoo (${modelo} ${m.odooId}).` };
  return { estado: "completado", resultado: { modelo, odoo_id: m.odooId, verificado: true, nota: "Vínculo verificado en el Odoo real; Odoo es la autoridad del maestro." } };
}
