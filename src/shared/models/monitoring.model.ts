// Y17 — Monitoreo de Infraestructura y Suscripciones (SGC-CSI-MOD-01).

export type CheckStatus = 'ok' | 'warning' | 'critical';
export type AlertSeverity = 'info' | 'media' | 'alta' | 'critica';

export interface MonitoredDomain {
  id: string;
  domain: string;
  registrar: string | null;
  dns_provider: string | null;
  expected_mx: string[];
  expected_spf_includes: string[];
  dkim_selector: string | null;
  check_ssl: boolean;
  is_active: boolean;
  notes: string | null;
  last_status: CheckStatus | null;
  last_checked_at: string | null;
  rdap_expires_at: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  name: string;
  provider: string | null;
  category: string | null;
  renewal_date: string | null;
  amount: number | null;
  currency: string | null;
  payment_method: string | null;
  account_owner: string | null;
  internal_responsible: string | null;
  impact_if_expired: string | null;
  panel_url: string | null;
  auto_renew: boolean;
  payment_ok: boolean;
  is_active: boolean;
  notes: string | null;
}

export interface DomainCheck {
  id: string;
  domain_id: string;
  check_type: string;
  status: CheckStatus;
  detail: string | null;
  raw_response: unknown;
  checked_at: string;
}

export interface InfraAlert {
  id: string;
  source_type: 'domain' | 'subscription';
  source_id: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  notified_channels: unknown;
  last_notified_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: 'Informativa',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

export const CHECK_TYPE_LABEL: Record<string, string> = {
  dns_resolution: 'Resolución DNS',
  rdap_status: 'Estado RDAP',
  mx_records: 'Registros MX',
  spf: 'SPF',
  dkim: 'DKIM',
  ssl: 'SSL',
  http: 'Web (HTTP)',
};

/** Días hasta una fecha ISO (YYYY-MM-DD); negativo si ya pasó. Null si no hay fecha. */
export function diasHasta(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.ceil((target - Date.now()) / 86400000);
}
