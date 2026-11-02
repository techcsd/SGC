import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { GastosService, GastoCategoria, GastoDirecto } from '../../../../shared/services/gastos.service';
import { PrivacidadService } from '../../../../shared/services/privacidad.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { Icon } from '../../../../shared/ui/icon/icon';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { clasificarConfianza, type ClasificacionConfianza } from '../../../../shared/utils/bitacora-ia.util';

interface CampoRevisionGasto {
  etiqueta: string;
  valor: string;
  clasificacion: ClasificacionConfianza;
}

/**
 * DF-gastos — registrar un gasto directo del proyecto (AS14, backend ya existía
 * desde ago-2026, sin pantalla). Formulario manual + "Entender con IA" (foto de
 * la factura -> propuesta con confianza por campo -> el usuario siempre confirma).
 */
@Component({
  selector: 'app-gastos',
  imports: [TranslatePipe, Icon, DecimalPipe],
  templateUrl: './gastos.html',
  styleUrl: './gastos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Gastos implements OnInit {
  private proyectosService = inject(ProyectosService);
  private gastosService = inject(GastosService);
  private privacidadService = inject(PrivacidadService);
  private toast = inject(ToastService);

  proyectos = signal<Proyecto[]>([]);
  proyectosOrdenados = computed(() =>
    [...this.proyectos()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
  );
  categorias = signal<GastoCategoria[]>([]);
  gastos = signal<GastoDirecto[]>([]);
  cargandoLista = signal(false);

  proyectoId = signal<string | null>(null);
  categoria = signal('misc');
  concepto = signal('');
  monto = signal<number | null>(null);
  fecha = signal(new Date().toISOString().slice(0, 10));
  proveedor = signal('');
  rnc = signal('');
  ncf = signal('');
  numeroRecibo = signal('');

  facturaFile = signal<File | null>(null);
  facturaPreview = signal<string | null>(null);

  guardando = signal(false);
  formError = signal('');

  // ── "Entender con IA" ──────────────────────────────────────────────────────
  iaConsentimiento = signal(false);
  iaCargando = signal(false);
  iaError = signal('');
  iaPropuesta = signal<{ confianza: Record<string, number> } | null>(null);
  puedeEntenderIA = computed(() => !!this.facturaFile() && !this.iaCargando());

  camposRevision = computed<CampoRevisionGasto[]>(() => {
    const p = this.iaPropuesta();
    if (!p) return [];
    const out: CampoRevisionGasto[] = [];
    const agregar = (etiqueta: string, valor: string | null) => {
      if (!valor) return;
      out.push({ etiqueta, valor, clasificacion: clasificarConfianza(valor, p.confianza[etiqueta] ?? 0) });
    };
    agregar('proveedor', this.proveedor() || null);
    agregar('rnc', this.rnc() || null);
    agregar('ncf', this.ncf() || null);
    agregar('concepto', this.concepto() || null);
    agregar('total', this.monto() != null ? String(this.monto()) : null);
    return out;
  });

  puedeGuardar = computed(() =>
    !!this.proyectoId() && this.concepto().trim().length > 0 && (this.monto() ?? 0) > 0 && !this.guardando(),
  );

  async ngOnInit() {
    try {
      this.proyectos.set(await this.proyectosService.getAll());
    } catch { /* sin obras no se puede elegir proyecto */ }
    try {
      this.categorias.set(await this.gastosService.categorias());
    } catch { /* catálogo vacío cae al default 'misc' */ }
    try {
      this.iaConsentimiento.set(await this.privacidadService.miConsentimiento('ia'));
    } catch {
      this.iaConsentimiento.set(false);
    }
  }

  async elegirProyecto(id: string) {
    this.proyectoId.set(id || null);
    if (!id) { this.gastos.set([]); return; }
    this.cargandoLista.set(true);
    try {
      this.gastos.set(await this.gastosService.deProyecto(id));
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cargar el historial de gastos');
    } finally {
      this.cargandoLista.set(false);
    }
  }

  async onFoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const prev = this.facturaPreview();
    if (prev) URL.revokeObjectURL(prev);
    this.facturaFile.set(file);
    this.facturaPreview.set(URL.createObjectURL(file));
  }

  async entenderConIA() {
    const file = this.facturaFile();
    if (!file || this.iaCargando()) return;
    this.iaError.set('');
    this.iaCargando.set(true);
    this.iaPropuesta.set(null);
    try {
      const r = await this.gastosService.leerFactura(file);
      if (!r.ok || !r.lectura) {
        this.iaError.set(r.error || 'No se pudo leer la factura. Llénalo a mano.');
        return;
      }
      const l = r.lectura;
      if (l.proveedor && !this.proveedor().trim()) this.proveedor.set(l.proveedor);
      if (l.rnc && !this.rnc().trim()) this.rnc.set(l.rnc);
      if (l.ncf && !this.ncf().trim()) this.ncf.set(l.ncf);
      if (l.numero_recibo && !this.numeroRecibo().trim()) this.numeroRecibo.set(l.numero_recibo);
      if (l.concepto && !this.concepto().trim()) this.concepto.set(l.concepto);
      if (l.fecha) this.fecha.set(l.fecha);
      const total = l.total ?? (l.subtotal != null && l.itbis != null ? l.subtotal + l.itbis : null);
      if (total != null && this.monto() == null) this.monto.set(total);
      this.iaPropuesta.set({ confianza: r.confianza ?? {} });
    } catch (e: unknown) {
      this.iaError.set(e instanceof Error ? e.message : 'No se pudo leer la factura. Llénalo a mano.');
    } finally {
      this.iaCargando.set(false);
    }
  }

  descartarPropuestaIA() {
    this.iaPropuesta.set(null);
  }

  async guardar() {
    const proyectoId = this.proyectoId();
    if (!proyectoId) { this.formError.set('Elige la obra a la que pertenece este gasto.'); return; }
    if (!this.concepto().trim()) { this.formError.set('Describe en qué se gastó.'); return; }
    const monto = this.monto();
    if (!monto || monto <= 0) { this.formError.set('El monto debe ser mayor que cero.'); return; }

    this.formError.set('');
    this.guardando.set(true);
    try {
      const file = this.facturaFile();
      const reciboPath = file ? await this.gastosService.subirFoto(proyectoId, file) : null;
      await this.gastosService.crear({
        proyectoId,
        categoria: this.categoria(),
        concepto: this.concepto().trim(),
        monto,
        fecha: this.fecha(),
        reciboPath,
        proveedor: this.proveedor().trim() || null,
        rnc: this.rnc().trim() || null,
        ncf: this.ncf().trim() || null,
        numeroRecibo: this.numeroRecibo().trim() || null,
      });
      this.toast.success('Gasto registrado');
      this.limpiarFormulario();
      this.gastos.set(await this.gastosService.deProyecto(proyectoId));
    } catch (e) {
      this.formError.set(humanizeError(e).mensaje);
      this.toast.errorFrom(e, 'No se pudo registrar el gasto');
    } finally {
      this.guardando.set(false);
    }
  }

  private limpiarFormulario() {
    this.categoria.set('misc');
    this.concepto.set('');
    this.monto.set(null);
    this.fecha.set(new Date().toISOString().slice(0, 10));
    this.proveedor.set('');
    this.rnc.set('');
    this.ncf.set('');
    this.numeroRecibo.set('');
    const prev = this.facturaPreview();
    if (prev) URL.revokeObjectURL(prev);
    this.facturaFile.set(null);
    this.facturaPreview.set(null);
    this.iaPropuesta.set(null);
    this.iaError.set('');
  }

  categoriaLabel(clave: string): string {
    return this.categorias().find((c) => c.clave === clave)?.label ?? clave;
  }
}
