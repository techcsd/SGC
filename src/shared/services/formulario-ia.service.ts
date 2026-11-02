import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { invokeEdge } from '../utils/edge.util';
import type { PropuestaConduceIA, PropuestaMantenimientoIA, PropuestaChecklistIA } from '../utils/formulario-ia.util';

/**
 * DF1-B..E / F2b — cliente del lector IA genérico `leer-formulario`.
 * 'conduce_externo' y 'mantenimiento' están implementados del lado de la edge;
 * los demás devuelven `error_code: 'tipo_no_implementado'` (ver docs/IA-FLUJOS-ROLES.md).
 */
@Injectable({ providedIn: 'root' })
export class FormularioIaService {
  private supabase = inject(SupabaseService);

  async leerConduceExterno(input: { fotos: File[]; proyectoId?: string | null }): Promise<PropuestaConduceIA> {
    const fotos = await Promise.all(
      input.fotos.map(async (f) => ({ data: await this.aBase64(f), mime: f.type || 'image/jpeg' })),
    );
    return invokeEdge<PropuestaConduceIA>(this.supabase.client, 'leer-formulario', {
      tipo: 'conduce_externo',
      fotos,
      proyecto_id: input.proyectoId ?? null,
    });
  }

  /** F2b — nota de voz → descripción + vehículo sugerido + tipo preventivo/correctivo. */
  async leerMantenimiento(input: { audio: Blob }): Promise<PropuestaMantenimientoIA> {
    return invokeEdge<PropuestaMantenimientoIA>(this.supabase.client, 'leer-formulario', {
      tipo: 'mantenimiento',
      audio: { data: await this.aBase64(input.audio), mime: input.audio.type || 'audio/webm' },
    });
  }

  /** F2b — voz (+ fotos opcionales de daños) → respuesta ok/no por ítem del checklist.
   *  `items` son los ítems VISIBLES de la plantilla elegida (no un catálogo de la DB). */
  async leerChecklistVehiculo(input: {
    items: { id: string; etiqueta: string; es_critico: boolean }[];
    audio: Blob;
    fotos?: File[];
  }): Promise<PropuestaChecklistIA> {
    const fotos = await Promise.all(
      (input.fotos ?? []).map(async (f) => ({ data: await this.aBase64(f), mime: f.type || 'image/jpeg' })),
    );
    return invokeEdge<PropuestaChecklistIA>(this.supabase.client, 'leer-formulario', {
      tipo: 'checklist_vehiculo',
      items: input.items,
      audio: { data: await this.aBase64(input.audio), mime: input.audio.type || 'audio/webm' },
      fotos,
    });
  }

  /** Marca la propuesta de IA como aceptada (se usó para llenar el registro creado) o descartada. */
  async resolverPropuesta(propuestaId: string, estado: 'aceptada' | 'descartada', entidadId?: string): Promise<void> {
    await this.supabase.client
      .from('formulario_ia_propuestas')
      .update({ estado, entidad_id: entidadId ?? null, resuelta_en: new Date().toISOString() })
      .eq('id', propuestaId);
  }

  private aBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result);
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      r.readAsDataURL(blob);
    });
  }
}
