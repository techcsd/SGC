import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PagosObraService, PagoObra, PagoObraLinea, ResumenSemanaObra } from '../../../../shared/services/pagos-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { Paginador } from '../../../../shared/components/paginador/paginador';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { DecimalPipe } from '@angular/common';

type FiltroEstadoLinea = 'todos' | 'pendiente' | 'firmado' | 'ausente';
const CLAVE_ULTIMA_OBRA = 'sgc.pagos.ultimaObra';

/**
 * DB4 (Ronda DB) — Ingeniería › Pagos de la semana: el ingeniero arma la semana
 * (precarga el personal del último levantamiento), pone montos, cada persona
 * firma el DESCARGO, y «Enviar reporte» genera el PDF y lo manda por correo a
 * Legal/Eduardo (+ extras). Enviado = cerrado (solo admin reabre). Mockup DB4.
 */
@Component({
  selector: 'app-ingenieria-pagos',
  templateUrl: './pagos.html',
  styleUrl: './pagos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SignaturePad, FormDrawer, ConfirmDialog, Paginador, TranslatePipe, DecimalPipe],
})
export class IngenieriaPagos implements OnInit {
  private service = inject(PagosObraService);
  private proyectos = inject(ProyectosService);
  private user = inject(UserService);
  private toast = inject(ToastService);

  pad = viewChild(SignaturePad);

  obras = signal<ObraRef[]>([]);
  obraId = signal('');
  pagos = signal<PagoObra[]>([]);
  pagoSel = signal<PagoObra | null>(null);
  lineas = signal<PagoObraLinea[]>([]);
  correos = signal<string[]>([]);
  loading = signal(false);
  saving = signal(false);
  error = signal('');
  firmandoLinea = signal<PagoObraLinea | null>(null);
  pdfAbriendo = signal(false);
  enviarPedido = signal(false);
  reabrirPedido = signal(false);

  // ── DI — pantalla de arranque «Mis obras» ───────────────────────────────
  /** 'obras' = lista de arranque · 'detalle' = semana de una obra (como antes). */
  vista = signal<'obras' | 'detalle'>('obras');
  resumenPorObra = signal<Map<string, ResumenSemanaObra>>(new Map());
  loadingResumen = signal(false);
  filtroObra = signal('');
  ultimaObraId = signal<string | null>(null);

  readonly esAdmin = this.user.hasRole('admin');
  /** operar = ingenieros (el RPC re-valida por obra). */
  puedeOperar = computed(() =>
    this.esAdmin || this.user.hasRole('ingeniero_campo') || this.user.hasRole('gerente_proyectos') || this.user.hasRole('jefe_ingenieros'));

  firmadas = computed(() => this.lineas().filter((l) => l.estado === 'firmado').length);
  sinFirma = computed(() => this.lineas().filter((l) => l.estado !== 'firmado').length);
  totalFirmado = computed(() => this.lineas().filter((l) => l.estado === 'firmado').reduce((s, l) => s + Number(l.monto ?? 0), 0));
  cerrado = computed(() => this.pagoSel()?.estado === 'enviado');

  // ── «Mis obras» — KPIs + lista filtrada ─────────────────────────────────
  obrasFiltradas = computed(() => {
    const q = this.filtroObra().trim().toLowerCase();
    const base = q ? this.obras().filter((o) => o.nombre.toLowerCase().includes(q)) : this.obras();
    // Quien no puede operar en ninguna obra solo ve semanas YA enviadas (solo lectura).
    const visibles = this.puedeOperar() ? base : base.filter((o) => this.resumenPorObra().get(o.id)?.pago?.estado === 'enviado');
    const ultima = this.ultimaObraId();
    if (!ultima) return visibles;
    return [...visibles].sort((a, b) => (a.id === ultima ? -1 : b.id === ultima ? 1 : 0));
  });

  kpiAbiertas = computed(() => [...this.resumenPorObra().values()].filter((r) => r.pago?.estado === 'borrador').length);
  kpiEnviadas = computed(() => [...this.resumenPorObra().values()].filter((r) => r.pago?.estado === 'enviado').length);
  kpiSinEmpezar = computed(() => Math.max(0, this.obras().length - this.resumenPorObra().size));
  kpiTotalFirmado = computed(() => [...this.resumenPorObra().values()].reduce((s, r) => s + r.montoFirmado, 0));

  // ── Historial de semanas — paginado client-side ─────────────────────────
  semanasPage = signal(1);
  semanasPageSize = signal(10);
  semanasPaginadas = computed(() => {
    const desde = (this.semanasPage() - 1) * this.semanasPageSize();
    return this.pagos().slice(desde, desde + this.semanasPageSize());
  });

  // ── Personas de la semana — buscador + chip + paginado client-side ──────
  buscarPersona = signal('');
  filtroEstadoPersona = signal<FiltroEstadoLinea>('todos');
  personasPage = signal(1);
  personasPageSize = signal(10);
  lineasFiltradas = computed(() => {
    const q = this.buscarPersona().trim().toLowerCase();
    const f = this.filtroEstadoPersona();
    return this.lineas().filter((l) => {
      if (f !== 'todos' && l.estado !== f) return false;
      if (q && !l.nombre_snapshot.toLowerCase().includes(q)) return false;
      return true;
    });
  });
  lineasPaginadas = computed(() => {
    const desde = (this.personasPage() - 1) * this.personasPageSize();
    return this.lineasFiltradas().slice(desde, desde + this.personasPageSize());
  });

  async ngOnInit() {
    this.ultimaObraId.set(this.leerUltimaObra());
    try {
      const [obras, correos] = await Promise.all([
        this.proyectos.getDirectorio('personal'),
        this.service.correosDestino().catch(() => []),
      ]);
      this.obras.set(obras);
      this.correos.set(correos);
      if (obras.length === 1) {
        this.obraId.set(obras[0].id);
        this.vista.set('detalle');
        await this.cargarPagos();
      } else {
        await this.cargarResumenSemana();
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las obras.');
    }
  }

  /** DI — estado de la semana actual de TODAS las obras, en una sola query. */
  async cargarResumenSemana() {
    const obras = this.obras();
    if (!obras.length) { this.resumenPorObra.set(new Map()); return; }
    this.loadingResumen.set(true);
    this.error.set('');
    try {
      const { desde } = this.semanaActual();
      this.resumenPorObra.set(await this.service.resumenSemana(obras.map((o) => o.id), desde));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo cargar el estado de las obras.');
    } finally {
      this.loadingResumen.set(false);
    }
  }

  estadoDeObra(obraId: string): 'sin_crear' | 'borrador' | 'enviado' {
    return this.resumenPorObra().get(obraId)?.pago?.estado ?? 'sin_crear';
  }
  resumenDeObra(obraId: string): ResumenSemanaObra | undefined {
    return this.resumenPorObra().get(obraId);
  }

  /** Entra al detalle de una obra (desde «Mis obras» o por ser la única obra). */
  async abrirObra(obraId: string, pagoIdAutoAbrir?: string | null) {
    this.obraId.set(obraId);
    this.vista.set('detalle');
    this.guardarUltimaObra(obraId);
    await this.cargarPagos();
    if (pagoIdAutoAbrir) {
      const pago = this.pagos().find((p) => p.id === pagoIdAutoAbrir);
      if (pago) await this.abrir(pago);
    }
  }

  /** Vuelve a la pantalla de arranque «Mis obras». */
  async volverAObras() {
    this.vista.set('obras');
    this.obraId.set('');
    this.pagoSel.set(null);
    this.lineas.set([]);
    this.pagos.set([]);
    await this.cargarResumenSemana();
  }

  private guardarUltimaObra(obraId: string) {
    this.ultimaObraId.set(obraId);
    try { localStorage.setItem(CLAVE_ULTIMA_OBRA, obraId); } catch { /* best-effort */ }
  }
  private leerUltimaObra(): string | null {
    try { return localStorage.getItem(CLAVE_ULTIMA_OBRA); } catch { return null; }
  }

  /** Crea la semana en curso para `obraId` desde la pantalla «Mis obras». */
  async crearSemanaDesdeObras(obraId: string) {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const { desde, hasta } = this.semanaActual();
      const id = await this.service.crear(obraId, desde, hasta);
      await this.abrirObra(obraId, id);
    } catch (e: unknown) {
      this.toast.error('No se pudo crear la semana', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async cargarPagos() {
    const obra = this.obraId();
    this.pagoSel.set(null);
    this.lineas.set([]);
    this.semanasPage.set(1);
    if (!obra) { this.pagos.set([]); return; }
    this.loading.set(true);
    this.error.set('');
    try {
      this.pagos.set(await this.service.listar(obra));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las semanas.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Lunes–domingo de la semana en curso (RD). */
  private semanaActual(): { desde: string; hasta: string } {
    const hoy = new Date();
    const dow = (hoy.getDay() + 6) % 7; // 0 = lunes
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - dow);
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { desde: iso(lunes), hasta: iso(domingo) };
  }

  async crearSemana() {
    const obra = this.obraId();
    if (!obra || this.saving()) return;
    this.saving.set(true);
    try {
      const { desde, hasta } = this.semanaActual();
      const id = await this.service.crear(obra, desde, hasta);
      await this.cargarPagos();
      const pago = this.pagos().find((p) => p.id === id);
      if (pago) await this.abrir(pago);
    } catch (e: unknown) {
      this.toast.error('No se pudo crear la semana', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async abrir(p: PagoObra) {
    this.pagoSel.set(p);
    this.lineas.set([]);
    this.buscarPersona.set('');
    this.filtroEstadoPersona.set('todos');
    this.personasPage.set(1);
    try {
      this.lineas.set(await this.service.lineas(p.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las líneas.');
    }
  }

  /** Buscador/chip de la tabla de personas — reinician la página al cambiar. */
  buscarPersonaCambio(q: string) { this.buscarPersona.set(q); this.personasPage.set(1); }
  filtrarPersonaPor(f: FiltroEstadoLinea) { this.filtroEstadoPersona.set(f); this.personasPage.set(1); }

  async guardarMonto(l: PagoObraLinea, montoRaw: string) {
    const monto = montoRaw === '' ? null : Number(montoRaw);
    if (monto != null && (!Number.isFinite(monto) || monto < 0)) return;
    try {
      await this.service.guardarLinea(l.id, { monto });
      this.lineas.update((ls) => ls.map((x) => (x.id === l.id ? { ...x, monto } : x)));
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    }
  }

  async guardarConcepto(l: PagoObraLinea, concepto: string) {
    try {
      await this.service.guardarLinea(l.id, { concepto: concepto || null });
      this.lineas.update((ls) => ls.map((x) => (x.id === l.id ? { ...x, concepto: concepto || x.concepto } : x)));
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    }
  }

  async marcarAusente(l: PagoObraLinea, ausente: boolean) {
    try {
      await this.service.guardarLinea(l.id, { ausente });
      this.lineas.update((ls) => ls.map((x) => (x.id === l.id ? { ...x, estado: ausente ? 'ausente' : 'pendiente' } : x)));
    } catch (e: unknown) {
      this.toast.error('No se pudo marcar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    }
  }

  abrirFirma(l: PagoObraLinea) { this.firmandoLinea.set(l); }
  cerrarFirma() { this.firmandoLinea.set(null); }

  async guardarFirma() {
    const l = this.firmandoLinea();
    const pago = this.pagoSel();
    const pad = this.pad();
    if (!l || !pago || !pad || this.saving()) return;
    if (pad.isEmpty()) { this.toast.error('Falta la firma', 'La persona debe firmar en el recuadro.'); return; }
    this.saving.set(true);
    try {
      const blob = await pad.toBlob();
      if (!blob) throw new Error('No se pudo capturar la firma.');
      const path = await this.service.subirFirma(pago.id, l.id, blob);
      await this.service.guardarLinea(l.id, { firmaPath: path });
      this.lineas.update((ls) => ls.map((x) => (x.id === l.id ? { ...x, estado: 'firmado', firma_path: path, firmado_at: new Date().toISOString() } : x)));
      this.firmandoLinea.set(null);
      this.toast.success('Descargo firmado', `${l.nombre_snapshot} quedó firmado.`);
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar la firma', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  /** Abre la confirmación de envío (reemplaza confirm() nativo). */
  pedirEnviar() {
    const pago = this.pagoSel();
    if (!pago || this.saving()) return;
    this.enviarPedido.set(true);
  }
  cancelarEnviar() { this.enviarPedido.set(false); }

  mensajeEnviar(): string {
    const correos = this.correos().join(', ') || '(sin correos configurados)';
    return `¿Enviar el reporte con ${this.firmadas()} descargo(s) firmado(s)? Al enviar, la semana queda cerrada y el PDF llega a: ${correos}.`;
  }

  async enviar() {
    const pago = this.pagoSel();
    this.enviarPedido.set(false);
    if (!pago || this.saving()) return;
    this.saving.set(true);
    try {
      await this.service.enviar(pago.id);
      this.toast.success('Reporte enviado', 'La semana quedó cerrada; el PDF va en camino por correo.');
      await this.cargarPagos();
      const ref = this.pagos().find((p) => p.id === pago.id);
      if (ref) await this.abrir(ref);
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async crearComplemento() {
    const pago = this.pagoSel();
    if (!pago || this.saving()) return;
    this.saving.set(true);
    try {
      const id = await this.service.complemento(pago.id);
      await this.cargarPagos();
      const nuevo = this.pagos().find((p) => p.id === id);
      if (nuevo) await this.abrir(nuevo);
      this.toast.success('Complemento creado', 'Con las personas que quedaron sin firmar.');
    } catch (e: unknown) {
      this.toast.error('No se pudo crear el complemento', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  /** Abre la confirmación de reapertura (reemplaza confirm() nativo). */
  pedirReabrir() {
    const pago = this.pagoSel();
    if (!pago || !this.esAdmin || this.saving()) return;
    this.reabrirPedido.set(true);
  }
  cancelarReabrir() { this.reabrirPedido.set(false); }

  async reabrir() {
    const pago = this.pagoSel();
    this.reabrirPedido.set(false);
    if (!pago || !this.esAdmin || this.saving()) return;
    this.saving.set(true);
    try {
      await this.service.reabrir(pago.id);
      await this.cargarPagos();
      const ref = this.pagos().find((p) => p.id === pago.id);
      if (ref) await this.abrir(ref);
    } catch (e: unknown) {
      this.toast.error('No se pudo reabrir', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async verPdf() {
    const path = this.pagoSel()?.pdf_path;
    if (!path || this.pdfAbriendo()) return;
    this.pdfAbriendo.set(true);
    try {
      window.open(await this.service.pdfUrl(path), '_blank');
    } catch (e: unknown) {
      this.toast.error('No se pudo abrir el PDF', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.pdfAbriendo.set(false);
    }
  }

  fecha(iso: string | null): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
}
