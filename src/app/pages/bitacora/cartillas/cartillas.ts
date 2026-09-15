import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  CartillasService, CartillaListItem, CartillaDetalle, AceroDiametro, CartillaFigura, CartillaAtado,
} from '../../../../shared/services/cartillas.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Icon } from '../../../../shared/ui/icon/icon';

interface ObraRef { id: string; nombre: string; }

/**
 * BO10 — Cartillas de acero (submódulo de Ingeniería, gate bitacora). Bandeja de
 * oficina (Ramón: revisar/observar/ejecutar/exportar) + captura en oficina + reporte
 * "Acero por obra" (kg por diámetro). El ingeniero de campo captura normalmente desde
 * la app (paridad crear_cartilla). Estados: borrador→enviada→revisada|observada→ejecutada.
 */
@Component({
  selector: 'app-cartillas',
  imports: [DecimalPipe, Skeleton, FormDrawer, Icon],
  templateUrl: './cartillas.html',
  styleUrl: './cartillas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Cartillas implements OnInit {
  private svc = inject(CartillasService);
  private proyectos = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  readonly ESTADOS = ['borrador', 'enviada', 'revisada', 'observada', 'ejecutada'];
  readonly ESTADO_LABEL: Record<string, string> = {
    borrador: 'Borrador', enviada: 'Enviada', revisada: 'Revisada', observada: 'Observada', ejecutada: 'Ejecutada',
  };
  estadoBadge(e: string): string {
    return e === 'ejecutada' ? 'success' : e === 'observada' ? 'danger' : e === 'revisada' ? 'info' : 'warning';
  }

  cartillas = signal<CartillaListItem[]>([]);
  obras = signal<ObraRef[]>([]);
  diametros = signal<AceroDiametro[]>([]);
  figuras = signal<CartillaFigura[]>([]);
  resumen = signal<{ diametro_codigo: string; piezas: number; peso_kg: number }[]>([]);
  loading = signal(true);
  error = signal('');

  // Filtros
  fObra = signal('');
  fEstado = signal('');
  fDesde = signal('');
  fHasta = signal('');

  esOficina = computed(() =>
    this.userService.hasRole('admin') || this.userService.hasModulo('bitacora'),
  );
  kgTotal = computed(() => this.resumen().reduce((s, r) => s + Number(r.peso_kg || 0), 0));

  figuraNombre = (codigo: string | null): string =>
    this.figuras().find((f) => f.codigo === codigo)?.nombre ?? codigo ?? '—';

  tramosText(tramos: { lado?: string; cm: number }[] | null): string {
    return (tramos ?? []).map((t) => (t.lado ? `${t.lado}:${t.cm}` : `${t.cm}`)).join(' + ');
  }

  async ngOnInit() {
    try {
      const [obras, diam, figs] = await Promise.all([
        this.proyectos.getDirectorio('conduce').catch(() => []),
        this.svc.diametros().catch(() => []),
        this.svc.figuras().catch(() => []),
      ]);
      this.obras.set((obras as ObraRef[]).map((o) => ({ id: o.id, nombre: o.nombre })));
      this.diametros.set(diam);
      this.figuras.set(figs);
    } catch { /* filtros opcionales */ }
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [lista, resumen] = await Promise.all([
        this.svc.listado({ proyectoId: this.fObra() || null, desde: this.fDesde() || null, hasta: this.fHasta() || null, estado: this.fEstado() || null }),
        this.svc.resumenAcero({ proyectoId: this.fObra() || null, desde: this.fDesde() || null, hasta: this.fHasta() || null }),
      ]);
      this.cartillas.set(lista);
      this.resumen.set(resumen);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las cartillas.');
    } finally {
      this.loading.set(false);
    }
  }

  limpiarFiltros() {
    this.fObra.set(''); this.fEstado.set(''); this.fDesde.set(''); this.fHasta.set('');
    this.cargar();
  }

  exportar() {
    const rows = this.cartillas().map((c) => ({
      Folio: c.folio ?? '', Obra: c.proyecto ?? '', Ingeniero: c.ingeniero ?? '',
      Fecha: this.formatFecha(c.fecha), Estado: this.ESTADO_LABEL[c.estado] ?? c.estado,
      'Peso (kg)': c.peso_total_kg,
    }));
    exportarExcel('cartillas', rows);
  }

  exportarAcero() {
    const rows = this.resumen().map((r) => ({ Diámetro: r.diametro_codigo, Piezas: r.piezas, 'Peso (kg)': r.peso_kg }));
    exportarExcel('acero-por-obra', rows);
  }

  // ── Detalle ─────────────────────────────────────────────────────────────
  detalle = signal<CartillaDetalle | null>(null);
  detalleOpen = signal(false);
  detalleLoading = signal(false);
  fotoUrls = signal<Record<string, string>>({});
  planoUrl = signal<string | null>(null);
  estadoNota = signal('');
  estadoBusy = signal(false);

  async abrirDetalle(c: CartillaListItem) {
    this.detalleOpen.set(true);
    this.detalleLoading.set(true);
    this.detalle.set(null);
    this.estadoNota.set('');
    this.fotoUrls.set({});
    this.planoUrl.set(null);
    try {
      const d = await this.svc.detalle(c.id);
      this.detalle.set(d);
      for (const p of d.fotos) this.svc.getFotoUrl(p).then((u) => { if (u) this.fotoUrls.update((m) => ({ ...m, [p]: u })); });
      if (d.plano_path) this.svc.getFotoUrl(d.plano_path).then((u) => this.planoUrl.set(u));
    } catch (e) {
      this.toast.error('No se pudo abrir', e instanceof Error ? e.message : undefined);
      this.detalleOpen.set(false);
    } finally {
      this.detalleLoading.set(false);
    }
  }
  cerrarDetalle() { this.detalleOpen.set(false); }

  // Acciones de estado disponibles según estado + rol.
  puedeRevisar = computed(() => { const d = this.detalle(); return !!d && this.esOficina() && (d.estado === 'enviada' || d.estado === 'observada'); });
  puedeObservar = computed(() => { const d = this.detalle(); return !!d && this.esOficina() && (d.estado === 'enviada' || d.estado === 'revisada'); });
  puedeEjecutar = computed(() => { const d = this.detalle(); return !!d && d.estado === 'revisada'; });

  async cambiarEstado(estado: string) {
    const d = this.detalle();
    if (!d || this.estadoBusy()) return;
    if (estado === 'observada' && !this.estadoNota().trim()) { this.toast.error('Escribe la observación'); return; }
    this.estadoBusy.set(true);
    try {
      await this.svc.cambiarEstado(d.id, estado, this.estadoNota().trim() || null);
      this.toast.success('Cartilla actualizada', this.ESTADO_LABEL[estado] ?? estado);
      await this.abrirDetalle({ id: d.id } as CartillaListItem);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    } finally {
      this.estadoBusy.set(false);
    }
  }

  // ── Captura (oficina) ───────────────────────────────────────────────────
  capturaOpen = signal(false);
  cObra = signal('');
  cFecha = signal(todayIso());
  cNotas = signal('');
  cAtados = signal<CartillaAtado[]>([]);
  cGuardando = signal(false);
  cError = signal('');

  abrirCaptura() {
    this.cObra.set(this.fObra() || '');
    this.cFecha.set(todayIso());
    this.cNotas.set('');
    this.cError.set('');
    this.cAtados.set([{ identificador: '', elemento: '', cantidad_piezas: null, piezas: [] }]);
    this.capturaOpen.set(true);
  }
  cerrarCaptura() { this.capturaOpen.set(false); }

  addAtado() { this.cAtados.update((a) => [...a, { identificador: '', elemento: '', cantidad_piezas: null, piezas: [] }]); }
  removeAtado(i: number) { this.cAtados.update((a) => a.filter((_, x) => x !== i)); }
  setAtado(i: number, campo: 'identificador' | 'elemento', v: string) {
    this.cAtados.update((a) => a.map((at, x) => (x === i ? { ...at, [campo]: v } : at)));
  }
  addPieza(ai: number) {
    this.cAtados.update((a) => a.map((at, x) => (x === ai
      ? { ...at, piezas: [...at.piezas, { marca: '', diametro_codigo: this.diametros()[0]?.codigo ?? null, figura_codigo: this.figuras()[0]?.codigo ?? null, tramos_cm: [{ cm: 0 }], longitud_total_cm: null, cantidad: 1, peso_kg: null }] }
      : at)));
  }
  removePieza(ai: number, pi: number) {
    this.cAtados.update((a) => a.map((at, x) => (x === ai ? { ...at, piezas: at.piezas.filter((_, y) => y !== pi) } : at)));
  }
  setPieza(ai: number, pi: number, campo: string, v: string | number) {
    this.cAtados.update((a) => a.map((at, x) => {
      if (x !== ai) return at;
      return { ...at, piezas: at.piezas.map((p, y) => (y === pi ? { ...p, [campo]: v } : p)) };
    }));
  }
  setTramo(ai: number, pi: number, ti: number, cm: number) {
    this.cAtados.update((a) => a.map((at, x) => {
      if (x !== ai) return at;
      return { ...at, piezas: at.piezas.map((p, y) => {
        if (y !== pi) return p;
        const tramos = [...(p.tramos_cm ?? [])]; tramos[ti] = { ...tramos[ti], cm };
        return { ...p, tramos_cm: tramos };
      }) };
    }));
  }
  addTramo(ai: number, pi: number) {
    this.cAtados.update((a) => a.map((at, x) => {
      if (x !== ai) return at;
      return { ...at, piezas: at.piezas.map((p, y) => (y === pi ? { ...p, tramos_cm: [...(p.tramos_cm ?? []), { cm: 0 }] } : p)) };
    }));
  }

  // Peso en vivo de una pieza (kg = longitud_m × kg/m × cantidad).
  pesoPieza(p: { diametro_codigo: string | null; tramos_cm: { cm: number }[] | null; cantidad: number }): number {
    const kgm = this.diametros().find((d) => d.codigo === p.diametro_codigo)?.kg_por_m ?? 0;
    const long = (p.tramos_cm ?? []).reduce((s, t) => s + Number(t.cm || 0), 0);
    return Math.round((long / 100) * kgm * (Number(p.cantidad) || 0) * 1000) / 1000;
  }
  pesoTotalCaptura = computed(() =>
    this.cAtados().reduce((s, at) => s + at.piezas.reduce((ps, p) => ps + this.pesoPieza(p), 0), 0),
  );

  async guardarCaptura() {
    if (this.cGuardando()) return;
    if (!this.cObra()) { this.cError.set('Elige la obra.'); return; }
    const atados = this.cAtados().filter((a) => a.piezas.length > 0);
    if (!atados.length) { this.cError.set('Agrega al menos un atado con una pieza.'); return; }
    this.cGuardando.set(true);
    this.cError.set('');
    try {
      const id = crypto.randomUUID();
      await this.svc.crear({
        id, proyectoId: this.cObra(), fecha: this.cFecha(),
        atados: atados.map((a) => ({
          identificador: a.identificador || null, elemento: a.elemento || null,
          cantidad_piezas: a.piezas.length, piezas: a.piezas.map((p) => ({
            marca: p.marca || null, diametro_codigo: p.diametro_codigo, figura_codigo: p.figura_codigo,
            tramos_cm: p.tramos_cm ?? null, longitud_total_cm: null, cantidad: Number(p.cantidad) || 1, peso_kg: null,
          })),
        })),
        notas: this.cNotas().trim() || null,
      });
      this.toast.success('Cartilla enviada', 'Oficina la revisará.');
      this.capturaOpen.set(false);
      await this.cargar();
    } catch (e) {
      this.cError.set(e instanceof Error ? e.message : 'No se pudo guardar la cartilla.');
    } finally {
      this.cGuardando.set(false);
    }
  }
}
