import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PagosObraService, PagoObra, PagoObraLinea } from '../../../../shared/services/pagos-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { DecimalPipe } from '@angular/common';

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
  imports: [FormsModule, SignaturePad, FormDrawer, TranslatePipe, DecimalPipe],
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

  readonly esAdmin = this.user.hasRole('admin');
  /** operar = ingenieros (el RPC re-valida por obra). */
  puedeOperar = computed(() =>
    this.esAdmin || this.user.hasRole('ingeniero_campo') || this.user.hasRole('gerente_proyectos') || this.user.hasRole('jefe_ingenieros'));

  firmadas = computed(() => this.lineas().filter((l) => l.estado === 'firmado').length);
  sinFirma = computed(() => this.lineas().filter((l) => l.estado !== 'firmado').length);
  totalFirmado = computed(() => this.lineas().filter((l) => l.estado === 'firmado').reduce((s, l) => s + Number(l.monto ?? 0), 0));
  cerrado = computed(() => this.pagoSel()?.estado === 'enviado');

  async ngOnInit() {
    try {
      const [obras, correos] = await Promise.all([
        this.proyectos.getDirectorio('personal'),
        this.service.correosDestino().catch(() => []),
      ]);
      this.obras.set(obras);
      this.correos.set(correos);
      if (obras.length === 1) { this.obraId.set(obras[0].id); await this.cargarPagos(); }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las obras.');
    }
  }

  async cargarPagos() {
    const obra = this.obraId();
    this.pagoSel.set(null);
    this.lineas.set([]);
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
    try {
      this.lineas.set(await this.service.lineas(p.id));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las líneas.');
    }
  }

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

  async enviar() {
    const pago = this.pagoSel();
    if (!pago || this.saving()) return;
    if (!confirm(`¿Enviar el reporte con ${this.firmadas()} descargo(s) firmado(s)? Al enviar, la semana queda cerrada y el PDF llega a: ${this.correos().join(', ') || '(sin correos configurados)'}.`)) return;
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

  async reabrir() {
    const pago = this.pagoSel();
    if (!pago || !this.esAdmin || this.saving()) return;
    if (!confirm('¿Reabrir esta semana enviada? Queda registrado quién la reabrió.')) return;
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
