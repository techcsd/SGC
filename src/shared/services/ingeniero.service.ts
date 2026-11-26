import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import {
  ING_CONFIG_DEFECTO,
  ING_ESTADOS_ACTIVOS,
  IngConfigUI,
  configDesdeFilas,
  validarConfigNumero,
} from '../utils/ingeniero.util';

export interface IngTarea {
  id: string;
  origen: 'reporte_usuario' | 'crash_app' | 'error_web' | 'barrido';
  origen_ref: string | null;
  reporte_id: string | null;
  clasificacion: 'bug' | 'sugerencia' | 'crash' | 'barrido';
  titulo: string;
  texto_origen: string | null;
  severidad: 'baja' | 'media' | 'alta' | 'critica';
  estado: string;
  repo: 'sgc' | 'csd-app';
  modulo: string | null;
  plan: string | null;
  archivos: unknown;
  intentos: number;
  pr_url: string | null;
  pr_numero: number | null;
  veredictos: unknown;
  zona_roja: boolean;
  aprobacion_id: string | null;
  costo_ia: number;
  borrador_respuesta: string | null;
  motivo: string | null;
  prod_en: string | null;
  respondida_en: string | null;
  creada_en: string;
  updated_at: string;
}

export interface IngZonaRoja {
  aprobacionId: string;
  propuesta: string;
  prUrl: string | null;
  tarea: IngTarea | null;
}

export type IngClaveBoolean = 'agentes_auto_prod' | 'agentes_pausa_total';
export type IngAccionAdmin = 'rechazar' | 'relanzar' | 'marcar_respondida';

/** EA3 -- datos de la pestaña "Cambios del Ingeniero" (solo admin; RLS lo exige en el servidor). */
@Injectable({ providedIn: 'root' })
export class IngenieroService {
  private supabase = inject(SupabaseService);

  private _tareas = signal<IngTarea[]>([]);
  private _config = signal<IngConfigUI>({ ...ING_CONFIG_DEFECTO });
  private _zonaRoja = signal<IngZonaRoja[]>([]);
  private _costoHoy = signal(0);

  tareas = this._tareas.asReadonly();
  config = this._config.asReadonly();
  zonaRoja = this._zonaRoja.asReadonly();
  costoHoy = this._costoHoy.asReadonly();

  /** Tareas en curso (para el contador de la oficina). */
  activas = computed(() => this._tareas().filter((t) => (ING_ESTADOS_ACTIVOS as readonly string[]).includes(t.estado)).length);
  enRevision = computed(() => this._tareas().filter((t) => t.estado === 'en_revision').length);
  prodHoy = computed(() => {
    const ini = new Date();
    ini.setHours(0, 0, 0, 0);
    return this._tareas().filter((t) => t.prod_en && Date.parse(t.prod_en) >= ini.getTime()).length;
  });

  async cargar(): Promise<void> {
    const ini = new Date();
    ini.setHours(0, 0, 0, 0);
    const [tareasRes, configRes, usoRes] = await Promise.all([
      this.supabase.client.from('agente_ingeniero_tareas').select('*').order('creada_en', { ascending: false }).limit(100),
      this.supabase.client.from('agente_ingeniero_config').select('clave, valor'),
      this.supabase.client.from('uso_ia').select('costo_estimado').in('funcion', ['agente_ingeniero', 'agente_guardian']).gte('created_at', ini.toISOString()),
    ]);
    if (tareasRes.error) throw new Error(tareasRes.error.message);
    const tareas = (tareasRes.data ?? []) as IngTarea[];
    this._tareas.set(tareas);
    this._config.set(configDesdeFilas((configRes.data ?? []) as { clave: string; valor: unknown }[]));
    this._costoHoy.set(((usoRes.data ?? []) as { costo_estimado: number | null }[]).reduce((s, f) => s + Number(f.costo_estimado ?? 0), 0));

    const ids = tareas.filter((t) => t.zona_roja && t.aprobacion_id).map((t) => t.aprobacion_id as string);
    if (!ids.length) {
      this._zonaRoja.set([]);
      return;
    }
    const apr = await this.supabase.client.from('agente_aprobaciones').select('id, propuesta, pr_url, estado').in('id', ids).eq('estado', 'pendiente');
    this._zonaRoja.set(
      ((apr.data ?? []) as { id: string; propuesta: string; pr_url: string | null }[]).map((a) => ({
        aprobacionId: a.id,
        propuesta: a.propuesta,
        prUrl: a.pr_url,
        tarea: tareas.find((t) => t.aprobacion_id === a.id) ?? null,
      })),
    );
  }

  async guardarBooleano(clave: IngClaveBoolean, valor: boolean): Promise<void> {
    await this.rpc('ing_config_guardar', { p_clave: clave, p_valor: valor });
    this._config.update((c) => ({ ...c, [clave]: valor }));
  }

  /** Valida igual que el servidor; lanza Error('valor_invalido') sin tocar la red si no pasa. */
  async guardarNumero(clave: string, valor: unknown): Promise<void> {
    const n = validarConfigNumero(clave, valor);
    if (n === null) throw new Error('valor_invalido');
    await this.rpc('ing_config_guardar', { p_clave: clave, p_valor: n });
    this._config.update((c) => ({ ...c, [clave]: n }));
  }

  async accion(id: string, accion: IngAccionAdmin): Promise<void> {
    await this.rpc('ing_tarea_admin_accion', { p_id: id, p_accion: accion });
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.client.rpc(fn, args);
    if (error) throw error;
  }
}
