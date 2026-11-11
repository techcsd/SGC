import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { RrhhNominaParametro, RrhhNominaPeriodo } from '../models/rrhh-nomina.model';

/** DN-27 P2 — Nómina: SOLO parámetros + períodos (borrador). SIN motor de
 *  cálculo -- requiere validación del contador antes de construirlo.
 *  Sensible: toda lectura/escritura vía RPC auditada. */
@Injectable({ providedIn: 'root' })
export class RrhhNominaService {
  private supabase = inject(SupabaseService);

  async listarParametros(): Promise<RrhhNominaParametro[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_nomina_parametros_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhNominaParametro[];
  }

  async actualizarParametro(clave: string, valor: number, validadoPorContador: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('rrhh_nomina_parametro_actualizar', {
      p_clave: clave, p_valor: valor, p_validado_por_contador: validadoPorContador,
    });
    if (error) throw new Error(error.message);
  }

  async listarPeriodos(): Promise<RrhhNominaPeriodo[]> {
    const { data, error } = await this.supabase.client.rpc('rrhh_nomina_periodos_listar');
    if (error) throw new Error(error.message);
    return (data ?? []) as RrhhNominaPeriodo[];
  }

  async crearPeriodo(nombre: string, fechaDesde: string, fechaHasta: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('rrhh_nomina_periodo_crear', {
      p_nombre: nombre, p_fecha_desde: fechaDesde, p_fecha_hasta: fechaHasta,
    });
    if (error) throw new Error(error.message);
  }
}
