import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../services/supabase.service';
import { MisionPractica, RespuestaPractica, ResultadoPractica } from './practica.model';

/**
 * CM7 — modo práctica. Mantiene el estado del intento EN MEMORIA (nunca sale a la red,
 * salvo `practica_guardar_intento` al final para la nota). Evalúa objetivos y
 * penalizaciones → nota 0-100, estrellas (60/80/95), aprobada ≥80.
 */
@Injectable({ providedIn: 'root' })
export class PracticaService {
  private supabase = inject(SupabaseService);

  activa = signal(false);
  mision = signal<MisionPractica | null>(null);
  respuesta = signal<RespuestaPractica>({});
  private inicioMs = 0;

  entrar(m: MisionPractica) {
    this.mision.set(m);
    this.respuesta.set({});
    this.inicioMs = typeof performance !== 'undefined' ? performance.now() : 0;
    this.activa.set(true);
  }
  salir() { this.activa.set(false); this.mision.set(null); this.respuesta.set({}); }

  set<T>(k: string, v: T) { this.respuesta.update((r) => ({ ...r, [k]: v })); }

  /** Evalúa el estado actual contra los objetivos/penalizaciones de la misión. */
  evaluar(): ResultadoPractica {
    const m = this.mision();
    const r = this.respuesta();
    const objetivos = (m?.objetivos ?? []).map((o) => ({
      id: o.id, texto: o.texto, puntos: o.puntos, ok: o.cumple(r), consejo: o.consejo,
    }));
    const penal = (m?.penalizaciones ?? []).filter((p) => p.aplica(r)).map((p) => ({ texto: p.texto, puntos: p.puntos }));
    const bruto = objetivos.filter((o) => o.ok).reduce((s, o) => s + o.puntos, 0);
    const castigo = penal.reduce((s, p) => s + p.puntos, 0);
    const nota = Math.max(0, Math.min(100, bruto - castigo));
    const estrellas = nota >= 95 ? 3 : nota >= 80 ? 2 : nota >= 60 ? 1 : 0;
    const dur = this.inicioMs ? Math.round(((performance.now() - this.inicioMs) / 1000)) : 0;
    return { nota, estrellas, aprobada: nota >= 80, objetivos, penalizaciones: penal, duracionS: dur };
  }

  /** Guarda SOLO la nota (único dato real). No cuenta en KPIs/incentivos/avisos. */
  async guardar(res: ResultadoPractica): Promise<void> {
    const m = this.mision();
    if (!m) return;
    try {
      await this.supabase.client.rpc('practica_guardar_intento', {
        p_mision_id: m.id, p_version: m.version, p_nota: res.nota, p_estrellas: res.estrellas,
        p_aprobada: res.aprobada, p_duracion_s: res.duracionS,
        p_detalle: { objetivos: res.objetivos.map((o) => ({ id: o.id, ok: o.ok })) }, p_plataforma: 'web',
      });
    } catch { /* práctica: si falla el guardado, no pasa nada grave */ }
  }
}
