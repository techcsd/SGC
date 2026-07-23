import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { AvisoFlota } from '../models/aviso-flota.model';
import { Vehiculo } from '../models/vehiculo.model';
import { Conductor } from '../models/conductor.model';
import { todayIso, formatFechaDisplay } from '../utils/fecha.util';

// Orden de prioridad real (no alfabético: 'alta' < 'baja' < 'media' saldría mal).
const SEV_RANK: Record<string, number> = { alta: 0, media: 1, baja: 2 };

const SELECT = '*, vehiculo:vehiculos(placa,marca), conductor:conductores(nombre)';

@Injectable({ providedIn: 'root' })
export class AvisosFlotaService {
  private supabase = inject(SupabaseService);

  async getAll(): Promise<AvisoFlota[]> {
    const { data, error } = await this.supabase.client
      .from('avisos_flota')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AvisoFlota[];
  }

  /** Solo pendientes (para el panel de flotilla / alertas activas). */
  async getActivas(): Promise<AvisoFlota[]> {
    const { data, error } = await this.supabase.client
      .from('avisos_flota')
      .select(SELECT)
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    // Ordenar por prioridad real en el cliente (evita el orden alfabético de PostgREST).
    return ((data ?? []) as unknown as AvisoFlota[]).sort(
      (a, b) => (SEV_RANK[a.severidad] ?? 3) - (SEV_RANK[b.severidad] ?? 3),
    );
  }

  async atender(id: string, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('atender_aviso_flota', {
      p_id: id,
      p_nota: nota,
    });
    if (error) throw new Error(error.message);
  }

  async countPendientes(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('avisos_flota')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente');
    if (error) return 0;
    return count ?? 0;
  }

  /**
   * X1/X2 — evalúa server-side los avisos de vencimiento (licencias, matrículas,
   * seguros): genera/transiciona por-vencer→vencida con dedup estable y
   * auto-resuelve los que ya no aplican. Reemplaza a la generación client-side.
   */
  async evaluarVencimientos(): Promise<void> {
    const { error } = await this.supabase.client.rpc('evaluar_avisos_vencimiento', {
      p_vehiculo_id: null,
      p_conductor_id: null,
    });
    if (error) throw new Error(error.message);
  }

  /** Historial de avisos (atendidos + resueltos automáticamente). */
  async getHistorial(): Promise<AvisoFlota[]> {
    const { data, error } = await this.supabase.client
      .from('avisos_flota')
      .select(SELECT)
      .in('estado', ['atendido', 'resuelto_auto'])
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AvisoFlota[];
  }

  /**
   * @deprecated Reemplazado por evaluarVencimientos() (server-side). Se conserva
   * la firma por compatibilidad; delega en el sweep e ignora los argumentos.
   */
  async generarVencimientos(
    vehiculos: Vehiculo[],
    conductores: Conductor[],
    umbralLicenciaDias = 30,
  ): Promise<number> {
    // Fecha local (no UTC): toISOString() salta al día siguiente después de las
    // ~20:00 en RD (UTC-4) → rompía la idempotencia diaria del dedup_key.
    const hoyIso = todayIso();
    const rows: Array<Omit<AvisoFlota, 'id' | 'created_at' | 'vehiculo' | 'conductor'>> = [];

    const diasHasta = (fecha: string): number => {
      const d = new Date(fecha + 'T00:00:00');
      return Math.floor((d.getTime() - new Date(hoyIso + 'T00:00:00').getTime()) / 86400000);
    };

    for (const c of conductores) {
      if (!c.activo || !c.licencia_vencimiento) continue;
      const dias = diasHasta(c.licencia_vencimiento);
      if (dias <= umbralLicenciaDias) {
        const vencida = dias < 0;
        rows.push({
          tipo: 'licencia',
          vehiculo_id: null,
          conductor_id: c.id,
          referencia_id: null,
          mensaje: vencida
            ? `Licencia de ${c.nombre} VENCIDA (venció ${formatFechaDisplay(c.licencia_vencimiento)}). No puede operar.`
            : `Licencia de ${c.nombre} por vencer en ${dias} día(s) (${formatFechaDisplay(c.licencia_vencimiento)}).`,
          severidad: vencida ? 'alta' : 'media',
          estado: 'pendiente',
          dedup_key: `licencia:${c.id}:${hoyIso}`,
          atendido_por: null,
          atendido_at: null,
          nota_atencion: null,
        });
      }
    }

    for (const v of vehiculos) {
      if (!v.activo) continue;
      const checks: Array<['matricula' | 'seguro', string | null | undefined, string]> = [
        ['matricula', v.vencimiento_matricula, 'Matrícula'],
        ['seguro', v.vencimiento_seguro, 'Seguro'],
      ];
      for (const [tipo, fecha, label] of checks) {
        if (!fecha) continue;
        const dias = diasHasta(fecha);
        if (dias <= umbralLicenciaDias) {
          const vencido = dias < 0;
          rows.push({
            tipo,
            vehiculo_id: v.id,
            conductor_id: null,
            referencia_id: null,
            mensaje: vencido
              ? `${label} de ${v.placa} VENCIDA (venció ${formatFechaDisplay(fecha)}).`
              : `${label} de ${v.placa} por vencer en ${dias} día(s) (${formatFechaDisplay(fecha)}).`,
            severidad: vencido ? 'alta' : 'media',
            estado: 'pendiente',
            dedup_key: `${tipo}:${v.id}:${hoyIso}`,
            atendido_por: null,
            atendido_at: null,
            nota_atencion: null,
          });
        }
      }
    }

    if (rows.length === 0) return 0;
    // ignoreDuplicates: la unique index de dedup_key evita duplicar por día.
    const { error, count } = await this.supabase.client
      .from('avisos_flota')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true, count: 'exact' });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
