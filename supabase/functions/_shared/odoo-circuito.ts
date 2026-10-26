// _shared/odoo-circuito.ts — CY23: circuit breaker hacia Odoo. Abre tras N
// fallos consecutivos (solo fallas de infraestructura: timeout/no_disponible/
// auth — nunca por un 400 de parámetros, que no dice nada sobre la salud de
// Odoo), responde rápido mientras está abierto (sin tocar Odoo), medio-abre
// tras el enfriamiento para probar con UNA petición, cierra si esa prueba
// sale bien. En memoria del isolate (sin Redis/KV, fuera de alcance de CY23).

export type EstadoCircuito = "cerrado" | "abierto" | "medio_abierto";

export class CircuitoOdoo {
  private fallosConsecutivos = 0;
  private estado: EstadoCircuito = "cerrado";
  private abiertoHasta = 0;
  private probandoMedioAbierto = false;

  constructor(
    private umbralFallos = 5,
    private enfriamientoMs = 30_000,
    private ahora: () => number = Date.now,
  ) {}

  get estadoActual(): EstadoCircuito {
    return this.estado;
  }

  /** true = puede intentar la llamada a Odoo; false = fallar rápido sin tocarlo. */
  puedeIntentar(): boolean {
    if (this.estado === "cerrado") return true;
    if (this.estado === "medio_abierto") return !this.probandoMedioAbierto; // una sola prueba a la vez
    // abierto
    if (this.ahora() < this.abiertoHasta) return false;
    this.estado = "medio_abierto";
    this.probandoMedioAbierto = true;
    return true;
  }

  registrarExito(): void {
    this.fallosConsecutivos = 0;
    this.estado = "cerrado";
    this.probandoMedioAbierto = false;
  }

  registrarFallo(): void {
    this.fallosConsecutivos++;
    if (this.estado === "medio_abierto" || this.fallosConsecutivos >= this.umbralFallos) {
      this.estado = "abierto";
      this.abiertoHasta = this.ahora() + this.enfriamientoMs;
      this.probandoMedioAbierto = false;
    }
  }
}
