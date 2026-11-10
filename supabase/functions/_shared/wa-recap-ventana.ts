// _shared/wa-recap-ventana.ts — DL5/DL-17 — ventana rodante por grupo/periodo
// para el recap (reemplaza `inicioDeHoyUtc()` de wa-extract, que tenía la
// ventana fija en UTC — CONTEXTO §2.5: el cron corría 9am UTC = 5am RD,
// resumiendo de madrugada → casi siempre <5 mensajes → se saltaba).

export type Periodo = "dia" | "semana";

export interface Ventana { desde: Date; hasta: Date }

/** Primera corrida (sin cursor previo): 24h para diario, 7 días para semanal. */
function ventanaPorDefecto(periodo: Periodo, hasta: Date): Date {
  const dias = periodo === "dia" ? 1 : 7;
  return new Date(hasta.getTime() - dias * 86_400_000);
}

/** `cursorHasta` = `wa_recap_cursor.hasta` de la corrida anterior (null si es la primera). */
export function calcularVentana(cursorHasta: string | null, ahora: Date, periodo: Periodo): Ventana {
  const desde = cursorHasta ? new Date(cursorHasta) : ventanaPorDefecto(periodo, ahora);
  return { desde, hasta: ahora };
}
