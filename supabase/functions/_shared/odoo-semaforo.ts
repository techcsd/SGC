// _shared/odoo-semaforo.ts — CY23: semáforo GLOBAL de concurrencia hacia Odoo
// (además de odoo-limite.ts, que limita por usuario). Protege la única cuenta
// técnica de un pico de usuarios simultáneos saturando Odoo a la vez. En
// memoria del isolate; sin cola (si está lleno, se rechaza con 429/503 y el
// cliente reintenta — encolar es otra pieza, fuera de alcance de CY23).
export class SemaforoOdoo {
  private enCurso = 0;
  constructor(private maxConcurrente = 8) {}

  /** true = hay cupo y lo reservó (llamar `liberar()` siempre, en un finally). */
  intentar(): boolean {
    if (this.enCurso >= this.maxConcurrente) return false;
    this.enCurso++;
    return true;
  }

  liberar(): void {
    this.enCurso = Math.max(0, this.enCurso - 1);
  }

  get ocupados(): number {
    return this.enCurso;
  }
}
