// _shared/odoo-externos.ts -- DS-18 (#11): conduces EXTERNOS (transporte de terceros) y su efecto sobre Odoo.
//
// Principio: el conduce externo NO es dueno de ningun movimiento. Transportista, placa, viaje y pago de transporte nunca generan una
// compra/venta ni un picking. Si el conduce afecta inventario, SGC ya creo (BV6) una SALIDA y/o una ENTRADA pendiente propias; esas
// son las que se publican por su camino canonico (odoo-salidas / odoo-recepciones). Este publicador solo:
//   - no hace nada si es meramente logistico (criterio 1) o si es el transporte de un RETIRO (lo publica el retiro: criterio 14.4),
//   - no hace nada si es de prueba (criterio 5: nunca stock en la compania real),
//   - re-encola la salida/entrada enlazadas cuando el externo cambia de estado (recibido/anulado) para que reevaluen con el estado
//     real, reutilizando la MISMA transicion canonica (criterio 4) y sin descontar de nuevo (criterio 2: enlaza, no duplica),
//   - deja visible en el externo a que movimientos de Odoo corresponde (AT11).
import { exito, type Marcar, omitido, type ResultadoEvento, clasificarFallo } from "./odoo-evento.ts";

export interface DatosConduceExterno {
  id: string; numero?: string | number | null; estado: "emitido" | "recibido" | "anulado" | string;
  afectaInventario: boolean; esPrueba: boolean;
  salidaId: string | null; entradaId: string | null; retiroId: string | null;
  /** Estado de sincronizacion de la salida/entrada enlazadas (solo lectura, para el texto del externo). */
  salidaPickingA: number | null; salidaPickingB: number | null; entradaPicking: number | null;
}
export interface DepsExterno {
  cargar(id: string): Promise<DatosConduceExterno | null>;
  marcar: Marcar;
  encolarSalida(salidaId: string): Promise<void>;
  encolarEntrada(entradaId: string): Promise<void>;
}

export async function publicarConduceExterno(d: DepsExterno, externoId: string, intentos: number): Promise<ResultadoEvento> {
  const x = await d.cargar(externoId);
  if (!x) return { estado: "error", error: "El conduce externo ya no existe en SGC." };
  const id = x.id;
  try {
    if (!x.afectaInventario) return await omitido(d.marcar, id, "logistico", "", null); // sin marca: «no aplica»
    if (x.retiroId) return await omitido(d.marcar, id, "retiro", "", null);              // lo publica el retiro (cuarentena), no el transporte
    if (x.esPrueba) return { estado: "completado", resultado: { omitido: "es_prueba" } };
    if (!x.salidaId && !x.entradaId) {
      return await omitido(d.marcar, id, "sin_movimiento", "El conduce afecta inventario pero no tiene salida ni entrada asociada: no hay nada que publicar.", "error");
    }
    // Reevalua cada documento por su camino canonico (idempotente: el publicador reutiliza lo ya hecho por `origin`).
    if (x.salidaId) await d.encolarSalida(x.salidaId);
    if (x.entradaId && x.estado !== "emitido") await d.encolarEntrada(x.entradaId); // entrante: pendiente hasta confirmar la recepcion
    const partes = [
      x.salidaId ? `salida ${x.salidaPickingA ? "con traslado en Odoo" : "por publicar"}` : null,
      x.entradaId ? (x.estado === "emitido" ? "entrada pendiente de confirmar" : "entrada reevaluada") : null,
    ].filter(Boolean).join(" · ");
    return await exito(d.marcar, id, x.salidaPickingA ?? x.entradaPicking ?? undefined,
      { salida_id: x.salidaId, entrada_id: x.entradaId, estado: x.estado }, x.estado === "anulado" ? `Anulado: ${partes}; se compensa por su documento.` : partes);
  } catch (err) {
    return await clasificarFallo(err, id, intentos, d.marcar);
  }
}
