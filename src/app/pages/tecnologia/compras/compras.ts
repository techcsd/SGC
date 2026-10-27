import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TecnologiaService } from '../../../../shared/services/tecnologia.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { SolicitudCompra, SolicitudCompraEstado, SolicitudCompraAdjunto } from '../../../../shared/models/solicitud.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatTimestampDisplay } from '../../../../shared/utils/fecha.util';
import { Icon } from '../../../../shared/ui/icon/icon';

// CO8 — flujo nuevo de Compras tecnológicas. El flujo viejo (pendiente/convertida/
// rechazada) se mantiene por si quedan filas históricas.
const ESTADO_META: Record<SolicitudCompraEstado, { label: string; badge: string }> = {
  pendiente: { label: 'Pendiente (flujo anterior)', badge: 'warning' },
  convertida: { label: 'Aprobada / convertida', badge: 'success' },
  rechazada: { label: 'Rechazada', badge: 'danger' },
  borrador: { label: 'Borrador', badge: 'neutral' },
  esperando_aprobacion: { label: 'Esperando aprobación', badge: 'warning' },
  aprobada: { label: 'Aprobada', badge: 'success' },
  comprada: { label: 'Comprada', badge: 'info' },
};

@Component({
  selector: 'app-tec-compras',
  imports: [ReactiveFormsModule, RouterLink, FormDrawer, Skeleton, Icon, DecimalPipe],
  templateUrl: './compras.html',
  styleUrl: './compras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecCompras implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private sanitizer = inject(DomSanitizer);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  formatTimestamp = formatTimestampDisplay;

  compras = signal<SolicitudCompra[]>([]);
  loading = signal(true);
  error = signal('');

  // CO8 — filtro por estado con conteo.
  filtroEstado = signal<SolicitudCompraEstado | 'all'>('all');
  readonly ESTADOS_FILTRO: SolicitudCompraEstado[] = ['borrador', 'esperando_aprobacion', 'aprobada', 'rechazada', 'comprada'];
  comprasFiltradas = computed(() => {
    const f = this.filtroEstado();
    return f === 'all' ? this.compras() : this.compras().filter((c) => c.estado === f);
  });
  conteoPorEstado(estado: SolicitudCompraEstado): number {
    return this.compras().filter((c) => c.estado === estado).length;
  }

  detailOpen = signal(false);
  detail = signal<SolicitudCompra | null>(null);
  private fotoUrls = signal<Record<string, string>>({});
  cotizacionUrls = signal<Record<string, string>>({});
  // DZ-02 (CZ1) — adjunto_id -> id de la biblioteca de Cotizaciones (si quedó registrada).
  private cotizacionBibliotecaIds = signal<Record<string, string>>({});
  previewSafeUrl = signal<SafeResourceUrl | null>(null);
  subiendoCotizacion = signal(false);
  decidiendo = signal(false);
  rechazoMotivo = signal('');
  mostrandoRechazo = signal(false);

  cotizacionForm = new FormGroup({
    tipo: new FormControl<'cotizacion' | 'factura' | 'otro'>('cotizacion', { nonNullable: true }),
    proveedor: new FormControl<string | null>(null),
    monto: new FormControl<number | null>(null),
  });

  miUsuarioId = computed(() => this.userService.profile()?.id ?? null);
  // CO8 — la RPC compra_tec_decidir también permite is_admin() además del aprobador_id fijado.
  esAprobador = computed(() => {
    const d = this.detail();
    if (!d) return false;
    return d.aprobador_id === this.miUsuarioId() || this.userService.hasRole('admin');
  });

  async ngOnInit() {
    await this.loadAll();
    // AT11 — enlaces de notificación/redirección (?id=) abren la ficha directamente.
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      const c = this.compras().find((x) => x.id === id);
      if (c) await this.openDetail(c);
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const compras = await this.tecnologia.getComprasTec();
      this.compras.set(compras);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las compras.');
    } finally {
      this.loading.set(false);
    }
  }

  getEstadoLabel(estado: SolicitudCompraEstado): string {
    return ESTADO_META[estado]?.label ?? estado;
  }
  getEstadoBadge(estado: SolicitudCompraEstado): string {
    return ESTADO_META[estado]?.badge ?? 'neutral';
  }
  /** "Esperando a Eduardo" — el mock pide el nombre de a quién, no solo el estado genérico. */
  estadoTarjeta(c: SolicitudCompra): string {
    if (c.estado === 'esperando_aprobacion' && c.aprobador?.nombre) return `Esperando a ${c.aprobador.nombre.split(' ')[0]}`;
    return this.getEstadoLabel(c.estado);
  }
  totalDe(c: SolicitudCompra): number {
    if (c.total != null) return c.total; // CQ1 — total calculado en servidor (preferido).
    return (c.items ?? []).reduce((sum, it) => sum + it.cantidad * (it.precio_unitario ?? 0), 0);
  }

  /** CQ1 — solo el dueño (o admin) puede editar, y solo mientras está en 'borrador'. */
  puedeEditar(c: SolicitudCompra): boolean {
    if (c.estado !== 'borrador') return false;
    return c.solicitante_id === this.miUsuarioId() || this.userService.hasRole('admin');
  }
  irAEditar(c: SolicitudCompra) {
    this.router.navigate(['/tecnologia/compras', c.id, 'editar']);
  }

  // ── Detalle ──────────────────────────────────────────────────
  async openDetail(c: SolicitudCompra) {
    this.detail.set(c);
    this.fotoUrls.set({});
    this.cotizacionUrls.set({});
    this.cotizacionBibliotecaIds.set({});
    this.previewSafeUrl.set(null);
    this.mostrandoRechazo.set(false);
    this.rechazoMotivo.set('');
    this.detailOpen.set(true);

    const fotos: Record<string, string> = {};
    await Promise.all(
      (c.items ?? []).filter((it) => it.foto_path).map(async (it) => {
        const url = await this.tecnologia.getEquipoFotoUrl(it.foto_path!);
        if (url) fotos[it.id] = url;
      }),
    );
    this.fotoUrls.set(fotos);

    const cots: Record<string, string> = {};
    await Promise.all(
      (c.adjuntos ?? []).map(async (a) => {
        cots[a.id] = await this.tecnologia.getCotizacionUrl(a.path);
      }),
    );
    this.cotizacionUrls.set(cots);
    const elegida = (c.adjuntos ?? []).find((a) => a.elegida);
    if (elegida && cots[elegida.id]) this.previewSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(cots[elegida.id]));

    this.cotizacionBibliotecaIds.set(
      await this.tecnologia.getCotizacionIdsPorAdjuntos((c.adjuntos ?? []).map((a) => a.id)),
    );
  }
  cotizacionBibliotecaId(adjuntoId: string): string | null {
    return this.cotizacionBibliotecaIds()[adjuntoId] ?? null;
  }
  closeDetail() {
    this.detailOpen.set(false);
  }
  itemFotoUrl(itemId: string): string | null {
    return this.fotoUrls()[itemId] ?? null;
  }
  cotizacionUrl(adjuntoId: string): string | null {
    return this.cotizacionUrls()[adjuntoId] ?? null;
  }
  tieneFotos(c: SolicitudCompra): boolean {
    return (c.items ?? []).some((it) => it.foto_path);
  }

  async onCotizacionSelected(event: Event) {
    const c = this.detail();
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!c || !file || this.subiendoCotizacion()) return;
    this.subiendoCotizacion.set(true);
    try {
      const v = this.cotizacionForm.getRawValue();
      await this.tecnologia.subirCotizacion(c.id, file, { tipo: v.tipo, proveedor: v.proveedor, monto: v.monto });
      const compras = await this.tecnologia.getComprasTec();
      this.compras.set(compras);
      const actualizada = compras.find((x) => x.id === c.id);
      if (actualizada) await this.openDetail(actualizada);
      this.toast.success('Cotización agregada', 'Ya puedes enviarla a aprobación.');
    } catch (e: unknown) {
      this.toast.error('No se pudo subir la cotización', e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendoCotizacion.set(false);
      (event.target as HTMLInputElement).value = '';
    }
  }

  async elegirCotizacion(adjunto: SolicitudCompraAdjunto) {
    const c = this.detail();
    if (!c) return;
    try {
      await this.tecnologia.elegirCotizacion(adjunto.id);
      const compras = await this.tecnologia.getComprasTec();
      this.compras.set(compras);
      const actualizada = compras.find((x) => x.id === c.id);
      if (actualizada) await this.openDetail(actualizada);
    } catch (e: unknown) {
      this.toast.error('No se pudo elegir la cotización', e instanceof Error ? e.message : undefined);
    }
  }

  async enviarAprobacion() {
    const c = this.detail();
    if (!c || this.decidiendo()) return;
    this.decidiendo.set(true);
    try {
      await this.tecnologia.enviarAprobacionCompraTec(c.id);
      await this.loadAll();
      const actualizada = this.compras().find((x) => x.id === c.id);
      if (actualizada) this.detail.set(actualizada);
      this.toast.success('Enviada', 'Ya está esperando aprobación.');
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar', e instanceof Error ? e.message : undefined);
    } finally {
      this.decidiendo.set(false);
    }
  }

  async aprobar() {
    await this.decidir(true, null);
  }
  confirmarRechazo() {
    const motivo = this.rechazoMotivo().trim();
    if (!motivo) { this.toast.error('Escribe el motivo del rechazo'); return; }
    void this.decidir(false, motivo);
  }
  private async decidir(aprobar: boolean, motivo: string | null) {
    const c = this.detail();
    if (!c || this.decidiendo()) return;
    this.decidiendo.set(true);
    try {
      await this.tecnologia.decidirCompraTec(c.id, aprobar, motivo);
      await this.loadAll();
      const actualizada = this.compras().find((x) => x.id === c.id);
      if (actualizada) this.detail.set(actualizada);
      this.mostrandoRechazo.set(false);
      this.toast.success(aprobar ? 'Aprobada' : 'Rechazada', aprobar ? 'El solicitante ya puede comprar.' : 'Se avisó al solicitante.');
    } catch (e: unknown) {
      this.toast.error('No se pudo decidir', e instanceof Error ? e.message : undefined);
    } finally {
      this.decidiendo.set(false);
    }
  }

  async marcarComprada() {
    const c = this.detail();
    if (!c || this.decidiendo()) return;
    this.decidiendo.set(true);
    try {
      await this.tecnologia.marcarCompradaCompraTec(c.id);
      await this.loadAll();
      const actualizada = this.compras().find((x) => x.id === c.id);
      if (actualizada) this.detail.set(actualizada);
      this.toast.success('Marcada como comprada');
    } catch (e: unknown) {
      this.toast.error('No se pudo marcar', e instanceof Error ? e.message : undefined);
    } finally {
      this.decidiendo.set(false);
    }
  }
}
