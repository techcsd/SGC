import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MonitoringService } from '../../../../shared/services/monitoring.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { formatTimestampDisplay, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import {
  MonitoredDomain, Subscription, DomainCheck, InfraAlert,
  SEVERITY_LABEL, CHECK_TYPE_LABEL, diasHasta,
} from '../../../../shared/models/monitoring.model';
import { Icon } from '../../../../shared/ui/icon/icon';

type Tab = 'dominios' | 'suscripciones' | 'alertas' | 'historico';

@Component({
  selector: 'app-tec-monitoreo',
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './monitoreo.html',
  styleUrl: './monitoreo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecMonitoreo implements OnInit {
  private service = inject(MonitoringService);
  private toast = inject(ToastService);

  readonly sevLabel = SEVERITY_LABEL;
  readonly checkLabel = CHECK_TYPE_LABEL;
  diasHasta = diasHasta;
  formatTs = formatTimestampDisplay;
  formatFecha = formatFechaDisplay;

  tab = signal<Tab>('dominios');
  loading = signal(true);
  error = signal('');

  domains = signal<MonitoredDomain[]>([]);
  subscriptions = signal<Subscription[]>([]);
  alerts = signal<InfraAlert[]>([]);
  checks = signal<DomainCheck[]>([]);

  alertasSoloActivas = signal(true);
  histDomainId = signal<string | null>(null);
  histTipo = signal<string | null>(null);

  alertasActivasCount = computed(() => this.alerts().filter((a) => !a.acknowledged_at && !a.resolved_at).length);

  // ── Drawer suscripción ──
  subDrawerOpen = signal(false);
  editingSubId = signal<string | null>(null);
  guardando = signal(false);
  subForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    provider: new FormControl(''),
    category: new FormControl(''),
    renewal_date: new FormControl<string | null>(null),
    amount: new FormControl<number | null>(null),
    currency: new FormControl('USD'),
    payment_method: new FormControl(''),
    account_owner: new FormControl(''),
    internal_responsible: new FormControl(''),
    impact_if_expired: new FormControl(''),
    panel_url: new FormControl(''),
    auto_renew: new FormControl(false),
    payment_ok: new FormControl(true),
    is_active: new FormControl(true),
    notes: new FormControl(''),
  });

  ngOnInit() {
    void this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [d, s, a] = await Promise.all([
        this.service.getDomains(),
        this.service.getSubscriptions(),
        this.service.getAlerts(this.alertasSoloActivas()),
      ]);
      this.domains.set(d);
      this.subscriptions.set(s);
      this.alerts.set(a);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar el monitoreo.');
    } finally {
      this.loading.set(false);
    }
  }

  async cambiarTab(t: Tab) {
    this.tab.set(t);
    if (t === 'historico' && this.checks().length === 0) await this.cargarHistorico();
  }

  // ── Semáforo ──
  semaforo(d: MonitoredDomain): 'ok' | 'warning' | 'critical' | 'unknown' {
    return (d.last_status as 'ok' | 'warning' | 'critical') ?? 'unknown';
  }

  // ── Alertas ──
  async toggleAlertasFiltro() {
    this.alertasSoloActivas.update((v) => !v);
    this.alerts.set(await this.service.getAlerts(this.alertasSoloActivas()));
  }

  async reconocer(a: InfraAlert) {
    try {
      await this.service.acknowledge(a.id);
      this.alerts.set(await this.service.getAlerts(this.alertasSoloActivas()));
      this.toast.success('Alerta reconocida.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo reconocer.');
    }
  }

  nombreFuente(a: InfraAlert): string {
    if (a.source_type === 'domain') return this.domains().find((d) => d.id === a.source_id)?.domain ?? 'dominio';
    return this.subscriptions().find((s) => s.id === a.source_id)?.name ?? 'suscripción';
  }

  // ── Histórico ──
  async cargarHistorico() {
    this.checks.set(await this.service.getChecks(this.histDomainId(), this.histTipo()));
  }
  async aplicarFiltroHist() { await this.cargarHistorico(); }
  nombreDominio(id: string): string {
    return this.domains().find((d) => d.id === id)?.domain ?? id;
  }

  async exportarHistorico() {
    const filas = this.checks().map((c) => ({
      Fecha: this.formatTs(c.checked_at),
      Dominio: this.nombreDominio(c.domain_id),
      Check: this.checkLabel[c.check_type] ?? c.check_type,
      Estado: c.status,
      Detalle: c.detail ?? '',
    }));
    await exportarExcel('monitoreo-checks', filas);
  }

  // ── Suscripción drawer ──
  abrirNuevaSub() {
    this.editingSubId.set(null);
    this.subForm.reset({ currency: 'USD', auto_renew: false, payment_ok: true, is_active: true });
    this.subDrawerOpen.set(true);
  }
  abrirEditarSub(s: Subscription) {
    this.editingSubId.set(s.id);
    this.subForm.reset({
      name: s.name, provider: s.provider ?? '', category: s.category ?? '', renewal_date: s.renewal_date,
      amount: s.amount, currency: s.currency ?? 'USD', payment_method: s.payment_method ?? '',
      account_owner: s.account_owner ?? '', internal_responsible: s.internal_responsible ?? '',
      impact_if_expired: s.impact_if_expired ?? '', panel_url: s.panel_url ?? '',
      auto_renew: s.auto_renew, payment_ok: s.payment_ok, is_active: s.is_active, notes: s.notes ?? '',
    });
    this.subDrawerOpen.set(true);
  }
  async guardarSub() {
    if (this.subForm.invalid) { this.subForm.markAllAsTouched(); return; }
    this.guardando.set(true);
    try {
      await this.service.saveSubscription({ id: this.editingSubId() ?? undefined, ...this.subForm.getRawValue() } as Partial<Subscription>);
      this.subDrawerOpen.set(false);
      this.subscriptions.set(await this.service.getSubscriptions());
      this.toast.success('Suscripción guardada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }
  async eliminarSub(s: Subscription) {
    if (!confirm(`¿Eliminar la suscripción «${s.name}»?`)) return;
    try {
      await this.service.deleteSubscription(s.id);
      this.subscriptions.set(await this.service.getSubscriptions());
      this.toast.success('Suscripción eliminada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  }
}
