// _shared/odoo-limite.ts — límite de peticiones por usuario (ventana deslizante en memoria
// del isolate). Protege la única cuenta técnica de Odoo del abuso o de un front en bucle.
export class LimitePorUsuario {
  private hits = new Map<string, number[]>();
  constructor(private max = 60, private ventanaMs = 60_000, private ahora: () => number = Date.now) {}

  /** Devuelve 0 si puede pasar, o los segundos que debe esperar. */
  intentar(usuario: string): number {
    const t = this.ahora();
    const recientes = (this.hits.get(usuario) ?? []).filter((x) => t - x < this.ventanaMs);
    if (recientes.length >= this.max) {
      this.hits.set(usuario, recientes);
      return Math.max(1, Math.ceil((this.ventanaMs - (t - recientes[0])) / 1000));
    }
    recientes.push(t);
    this.hits.set(usuario, recientes);
    if (this.hits.size > 5000) this.purgar(t);
    return 0;
  }

  private purgar(t: number) {
    for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.ventanaMs)) this.hits.delete(k);
  }
}
