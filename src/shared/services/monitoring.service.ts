import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { MonitoredDomain, Subscription, DomainCheck, InfraAlert } from '../models/monitoring.model';

/**
 * Y17 — Monitoreo de Infraestructura (SGC-CSI-MOD-01). Lectura gateada por RLS
 * (sgc.es_tecnologia()); los checks/alertas los escriben las edge functions.
 * CRUD de suscripciones/dominios desde el panel (RLS admin/tecnologia).
 */
@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private supabase = inject(SupabaseService);

  async getDomains(): Promise<MonitoredDomain[]> {
    const { data, error } = await this.supabase.client
      .from('monitored_domains')
      .select('*')
      .order('domain');
    if (error) throw new Error(error.message);
    return (data ?? []) as MonitoredDomain[];
  }

  async getSubscriptions(): Promise<Subscription[]> {
    const { data, error } = await this.supabase.client
      .from('subscriptions')
      .select('*')
      .order('is_active', { ascending: false })
      .order('renewal_date', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Subscription[];
  }

  async getAlerts(soloActivas = true): Promise<InfraAlert[]> {
    let q = this.supabase.client.from('alerts').select('*').order('created_at', { ascending: false });
    if (soloActivas) q = q.is('acknowledged_at', null).is('resolved_at', null);
    const { data, error } = await q.limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as InfraAlert[];
  }

  async getChecks(domainId?: string | null, tipo?: string | null): Promise<DomainCheck[]> {
    let q = this.supabase.client
      .from('domain_checks')
      .select('*')
      .order('checked_at', { ascending: false });
    if (domainId) q = q.eq('domain_id', domainId);
    if (tipo) q = q.eq('check_type', tipo);
    const { data, error } = await q.limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as DomainCheck[];
  }

  async acknowledge(alertId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('acknowledge_alert', { p_alert_id: alertId });
    if (error) throw new Error(error.message);
  }

  // ── Suscripciones CRUD ──
  async saveSubscription(sub: Partial<Subscription>): Promise<void> {
    const payload = { ...sub, updated_at: new Date().toISOString() };
    if (sub.id) {
      const { error } = await this.supabase.client.from('subscriptions').update(payload).eq('id', sub.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await this.supabase.client.from('subscriptions').insert(payload);
      if (error) throw new Error(error.message);
    }
  }

  async deleteSubscription(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('subscriptions').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
