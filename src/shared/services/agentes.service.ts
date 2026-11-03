import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';

export type AgenteClave = 'vigia' | 'capataz' | 'soporte' | 'auditor' | 'escriba' | 'cronista';
export type AgenteEstado = 'observando' | 'trabajando' | 'esperando_ok' | 'error' | 'inactivo';

export interface Agente {
  id: string;
  clave: AgenteClave;
  nombre: string;
  rol: string;
  nivel_max: 1 | 2 | 3;
  activo: boolean;
}

export interface AgenteEvento {
  id: string;
  agente_id: string;
  tipo: string;
  estado: AgenteEstado;
  resumen: string | null;
  creado_en: string;
}

export interface AgenteHallazgo {
  id: string;
  agente_id: string;
  severidad: 'baja' | 'media' | 'alta' | 'critica';
  titulo: string;
  detalle: string | null;
  estado: string;
  creado_en: string;
}

export interface AgenteAccion {
  id: string;
  agente_id: string;
  que_hizo: string;
  resultado: string | null;
  reversible: boolean;
  deshecha_en: string | null;
  creado_en: string;
}

export interface AgenteAprobacion {
  id: string;
  agente_id: string | null;
  propuesta: string;
  rama: string | null;
  pr_url: string | null;
  estado: 'pendiente' | 'aprobada' | 'ajuste' | 'descartada';
  creado_en: string;
}

export interface AgenteInformeDiario {
  id: string;
  fecha: string;
  contenido_md: string;
  enviado_en: string | null;
}

/** F5 (ronda DF) — datos y Realtime de "Tecnología › Agentes". Mismo patrón de
 *  canal que RealtimeNotificacionesService (postgres_changes por tabla). */
@Injectable({ providedIn: 'root' })
export class AgentesService {
  private supabase = inject(SupabaseService);
  private channels: RealtimeChannel[] = [];

  agentes = signal<Agente[]>([]);
  eventosPorAgente = signal<Record<string, AgenteEvento | undefined>>({});
  hallazgosHoy = signal<AgenteHallazgo[]>([]);
  accionesHoy = signal<AgenteAccion[]>([]);
  aprobacionesPendientes = signal<AgenteAprobacion[]>([]);
  informeHoy = signal<AgenteInformeDiario | null>(null);
  costoIaHoy = signal<{ costoHoy: number; topeDiario: number } | null>(null);

  /** DH16 — "Ejecutar ahora" para los agentes a demanda (auditor/capataz/soporte);
   *  usa la sesión real del usuario (las 3 edges exigen auth, no un secreto de cron). */
  async ejecutarAhora(clave: AgenteClave): Promise<void> {
    const { data, error } = await this.supabase.client.functions.invoke(`agente-${clave}`, { body: {} });
    if (error) throw new Error(error.message);
    const d = data as { error?: string } | null;
    if (d?.error) throw new Error(d.error);
  }

  async cargar(): Promise<void> {
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    const [agentesRes, eventosRes, hallazgosRes, accionesRes, aprobacionesRes, informeRes, costoRes] = await Promise.all([
      this.supabase.client.from('agentes').select('*').order('nombre'),
      this.supabase.client
        .from('agente_eventos')
        .select('*')
        .order('creado_en', { ascending: false })
        .limit(200),
      this.supabase.client
        .from('agente_hallazgos')
        .select('*')
        .gte('creado_en', hoyInicio.toISOString())
        .order('creado_en', { ascending: false }),
      this.supabase.client
        .from('agente_acciones')
        .select('*')
        .gte('creado_en', hoyInicio.toISOString())
        .order('creado_en', { ascending: false }),
      this.supabase.client
        .from('agente_aprobaciones')
        .select('*')
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false }),
      this.supabase.client
        .from('agente_informes_diarios')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase.client.rpc('agentes_costo_hoy_total').maybeSingle(),
    ]);

    this.agentes.set((agentesRes.data as Agente[]) ?? []);

    const ultimoPorAgente: Record<string, AgenteEvento> = {};
    for (const ev of (eventosRes.data as AgenteEvento[]) ?? []) {
      if (!ultimoPorAgente[ev.agente_id]) ultimoPorAgente[ev.agente_id] = ev;
    }
    this.eventosPorAgente.set(ultimoPorAgente);

    this.hallazgosHoy.set((hallazgosRes.data as AgenteHallazgo[]) ?? []);
    this.accionesHoy.set((accionesRes.data as AgenteAccion[]) ?? []);
    this.aprobacionesPendientes.set((aprobacionesRes.data as AgenteAprobacion[]) ?? []);
    this.informeHoy.set((informeRes.data as AgenteInformeDiario | null) ?? null);

    const costo = costoRes.data as { costo_hoy: number; tope_diario: number } | null;
    this.costoIaHoy.set(costo ? { costoHoy: Number(costo.costo_hoy), topeDiario: Number(costo.tope_diario) } : null);
  }

  /** Se suscribe una vez; llamar desde ngOnInit del componente y `detener()` desde ngOnDestroy. */
  escuchar(onCambio: () => void): void {
    if (this.channels.length) return;
    this.channels.push(
      this.supabase.client
        .channel('rt-agente-eventos')
        .on('postgres_changes', { event: 'INSERT', schema: 'sgc', table: 'agente_eventos' }, () => onCambio())
        .subscribe(),
      this.supabase.client
        .channel('rt-agente-aprobaciones')
        .on('postgres_changes', { event: '*', schema: 'sgc', table: 'agente_aprobaciones' }, () => onCambio())
        .subscribe(),
      this.supabase.client
        .channel('rt-agente-acciones')
        .on('postgres_changes', { event: '*', schema: 'sgc', table: 'agente_acciones' }, () => onCambio())
        .subscribe(),
    );
  }

  detener(): void {
    for (const ch of this.channels) void this.supabase.client.removeChannel(ch);
    this.channels = [];
  }

  async decidirAprobacion(id: string, decision: 'aprobada' | 'ajuste' | 'descartada', nota?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('decidir_agente_aprobacion', {
      p_id: id,
      p_decision: decision,
      p_nota: nota ?? null,
    });
    if (error) throw error;
  }

  async deshacerAccion(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('deshacer_agente_accion', { p_id: id });
    if (error) throw error;
  }

  async enviarInformeDiario(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('agente_informe_enviar', { p_id: id });
    if (error) throw error;
  }
}
