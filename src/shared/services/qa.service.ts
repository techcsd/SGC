import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { UserService } from '../../app/core/services/user.service';
import { SignedUrlCache } from './signed-url-cache.service';
import {
  QaTestCase,
  QaTestRun,
  QaTestRunResult,
  QaResultadoPatch,
  QaPlataforma,
  QaPrioridad,
} from '../models/qa.model';

const BUCKET = 'qa';

export interface QaCaseFiltros {
  modulo?: string | null;
  plataforma?: QaPlataforma | null;
  prioridad?: QaPrioridad | null;
  activo?: boolean | null;
}

/** Payload de alta/edición de un caso (sin campos de sistema). */
export interface QaCaseInput {
  modulo: string;
  titulo: string;
  precondiciones: string | null;
  pasos: string | null;
  resultado_esperado: string | null;
  prioridad: QaPrioridad;
  plataforma: QaPlataforma;
  activo: boolean;
  orden: number | null;
}

/**
 * AC3 — Gestión de pruebas (QA). Casos reutilizables + corridas fechadas.
 * Lectura/escritura PostgREST plana (RLS exige sgc.es_tecnologia()), salvo la
 * creación de corrida que usa el RPC `qa_crear_corrida` (snapshotea los casos).
 */
@Injectable({ providedIn: 'root' })
export class QaService {
  private supabase = inject(SupabaseService);
  private userService = inject(UserService);
  private signedUrls = inject(SignedUrlCache);

  // ── Casos ──────────────────────────────────────────────────────────────
  async getCases(filtros: QaCaseFiltros = {}): Promise<QaTestCase[]> {
    let q = this.supabase.client
      .from('qa_test_cases')
      .select('*')
      .order('modulo', { ascending: true })
      .order('orden', { ascending: true, nullsFirst: false })
      .order('titulo', { ascending: true });

    if (filtros.modulo) q = q.eq('modulo', filtros.modulo);
    if (filtros.plataforma) q = q.eq('plataforma', filtros.plataforma);
    if (filtros.prioridad) q = q.eq('prioridad', filtros.prioridad);
    if (filtros.activo !== null && filtros.activo !== undefined) q = q.eq('activo', filtros.activo);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as QaTestCase[];
  }

  async createCase(input: QaCaseInput): Promise<QaTestCase> {
    const { data, error } = await this.supabase.client
      .from('qa_test_cases')
      .insert({ ...input, creado_por: this.userService.profile()?.id ?? null })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as QaTestCase;
  }

  async updateCase(id: string, input: Partial<QaCaseInput>): Promise<QaTestCase> {
    const { data, error } = await this.supabase.client
      .from('qa_test_cases')
      .update(input)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as QaTestCase;
  }

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('qa_test_cases')
      .update({ activo })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Corridas ───────────────────────────────────────────────────────────
  async getRuns(): Promise<QaTestRun[]> {
    const { data, error } = await this.supabase.client
      .from('qa_test_runs')
      .select('*')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as QaTestRun[];
  }

  async getRun(id: string): Promise<{ run: QaTestRun; resultados: QaTestRunResult[] }> {
    const { data, error } = await this.supabase.client
      .from('qa_test_runs')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    const resultados = await this.getResultados(id);
    return { run: data as QaTestRun, resultados };
  }

  /** RPC — crea la corrida y snapshotea los casos elegidos como 'pendiente'. */
  async crearCorrida(
    plataforma: QaPlataforma,
    version: string,
    titulo: string,
    casoIds: string[],
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('qa_crear_corrida', {
      p_plataforma: plataforma,
      p_version: version || null,
      p_titulo: titulo || null,
      p_caso_ids: casoIds,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getResultados(runId: string): Promise<QaTestRunResult[]> {
    const { data, error } = await this.supabase.client
      .from('qa_test_run_results')
      .select('*')
      .eq('run_id', runId)
      .order('modulo', { ascending: true })
      .order('caso_titulo', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as QaTestRunResult[];
  }

  async setResultado(resultId: string, patch: QaResultadoPatch): Promise<QaTestRunResult> {
    const { data, error } = await this.supabase.client
      .from('qa_test_run_results')
      .update(patch)
      .eq('id', resultId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as QaTestRunResult;
  }

  async completarCorrida(runId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('qa_test_runs')
      .update({ estado: 'completada' })
      .eq('id', runId);
    if (error) throw new Error(error.message);
  }

  // ── Defectos (Reportes de errores) ───────────────────────────────────────
  /**
   * Crea una entrada en `app_error_reports` (source='web', tipo='error') vía el
   * RPC `report_app_error`, prellenada con el caso fallado. Devuelve el id para
   * enlazarlo en `qa_test_run_results.error_report_id`.
   */
  async crearReporteError(caso: {
    titulo: string;
    modulo: string;
    notas?: string | null;
    versionObjetivo?: string | null;
    runId?: string;
  }): Promise<string> {
    const mensaje = `[QA] Falla en "${caso.titulo}" (${caso.modulo})` +
      (caso.notas ? ` — ${caso.notas}` : '');
    const { data, error } = await this.supabase.client.rpc('report_app_error', {
      p_error_type: 'error',
      p_message: mensaje.slice(0, 500),
      p_stack: null,
      p_context: {
        origen: 'qa',
        modulo: caso.modulo,
        caso: caso.titulo,
        run_id: caso.runId ?? null,
        version_objetivo: caso.versionObjetivo ?? null,
      },
      p_device_brand: 'QA',
      p_device_model: 'Corrida de pruebas',
      p_os_version: null,
      p_app_version: caso.versionObjetivo ?? null,
      p_platform: 'web',
      p_source: 'web',
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  // ── Evidencia (bucket privado 'qa') ──────────────────────────────────────
  async uploadEvidencia(runId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `run/${runId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw new Error(error.message);
    return path;
  }

  async getEvidenciaUrl(path: string | null | undefined): Promise<string> {
    return this.signedUrls.signed(BUCKET, path);
  }
}
