import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../services/supabase.service';
import { PracticaClienteService } from './practica-cliente.service';
import { MisionPractica, RespuestaPractica, ResultadoPractica, ResultadoEquipoFila, ResultadoPersonaFila } from './practica.model';

/**
 * CM7 — modo práctica. Mantiene el estado del intento EN MEMORIA (nunca sale a la red,
 * salvo `practica_guardar_intento` al final para la nota). Evalúa objetivos y
 * penalizaciones → nota 0-100, estrellas (60/80/95), aprobada ≥80.
 */
@Injectable({ providedIn: 'root' })
export class PracticaService {
  private supabase = inject(SupabaseService);
  private practicaCliente = inject(PracticaClienteService);

  activa = signal(false);
  mision = signal<MisionPractica | null>(null);
  respuesta = signal<RespuestaPractica>({});
  private inicioMs = 0;

  entrar(m: MisionPractica) {
    this.mision.set(m);
    this.respuesta.set({});
    this.inicioMs = typeof performance !== 'undefined' ? performance.now() : 0;
    // CM7 7b — misión con pantalla real: activa el cliente de práctica con su escenario.
    if (m.escenario || m.rutaReal) this.practicaCliente.entrar(m.escenario ?? {});
    this.activa.set(true);
  }
  salir() {
    this.practicaCliente.salir();
    this.activa.set(false);
    this.mision.set(null);
    this.respuesta.set({});
  }

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

  /** CM7 7b — evalúa una misión con PANTALLA REAL sobre lo que el usuario escribió
   *  (capturado en memoria por el cliente de práctica). Sin penalizaciones. */
  evaluarReal(): ResultadoPractica {
    const m = this.mision();
    const esc = this.practicaCliente.escrituras;
    const objetivos = (m?.objetivosReales ?? []).map((o) => ({
      id: o.id, texto: o.texto, puntos: o.puntos, ok: o.cumple(esc), consejo: o.consejo,
    }));
    const bruto = objetivos.filter((o) => o.ok).reduce((s, o) => s + o.puntos, 0);
    const nota = Math.max(0, Math.min(100, bruto));
    const estrellas = nota >= 95 ? 3 : nota >= 80 ? 2 : nota >= 60 ? 1 : 0;
    const ahora = typeof performance !== 'undefined' ? performance.now() : 0;
    const dur = this.inicioMs ? Math.round((ahora - this.inicioMs) / 1000) : 0;
    return { nota, estrellas, aprobada: nota >= 80, objetivos, penalizaciones: [], duracionS: dur };
  }

  /** ¿Ya apareció la escritura que marca la misión como completada? */
  metaCumplida(): boolean {
    const clave = this.mision()?.metaWrite;
    if (!clave) return false;
    this.practicaCliente.cambios(); // reactividad
    return this.practicaCliente.escrituras.some((e) => e.tabla === clave);
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

  // ── CM7 7c — panel de resultados del equipo (jefe/RRHH/admin) ──
  /** ¿El usuario actual puede ver el panel de equipo? */
  async puedeVerEquipo(): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('practica_puede_ver_equipo');
    if (error) return false;
    return !!data;
  }

  /** Resumen por persona de la gente que el usuario actual puede ver. */
  async resultadosEquipo(): Promise<ResultadoEquipoFila[]> {
    const { data, error } = await this.supabase.client.rpc('practica_resultados_equipo');
    if (error) throw new Error(error.message);
    return (data ?? []) as ResultadoEquipoFila[];
  }

  /** Detalle por misión de una persona (si el que pregunta puede verla). */
  async resultadosPersona(usuarioId: string): Promise<ResultadoPersonaFila[]> {
    const { data, error } = await this.supabase.client.rpc('practica_resultados_persona', { p_usuario_id: usuarioId });
    if (error) throw new Error(error.message);
    return (data ?? []) as ResultadoPersonaFila[];
  }
}
