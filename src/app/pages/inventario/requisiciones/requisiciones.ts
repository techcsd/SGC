import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { BodegasService } from '../../../../shared/services/bodegas.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SolicitudMaterial } from '../../../../shared/models/solicitud.model';
import { Bodega } from '../../../../shared/models/bodega.model';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatFechaHoraDisplay } from '../../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'warning',
  aprobada: 'info',
  entregada: 'success',
  cerrada: 'success',
  rechazada: 'danger',
};

// A2: "aprobada" = despachada en parte y con compra pendiente por el faltante.
const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada (en compra)',
  entregada: 'Entregada',
  cerrada: 'Cerrada',
  rechazada: 'Rechazada',
};

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * AS7 — Bandeja GLOBAL de requisiciones (todas las obras). Reusa el mismo
 * `getAll()` cuya RLS decide qué ve cada quien: los privilegiados
 * (`puede_ver_todas_requisiciones`) ven todo; el ingeniero solo lo suyo (aunque
 * ese perfil usa "Mis requisiciones"). Gestión (Aprobar/Rechazar) via los RPCs
 * existentes — el servidor valida quién puede hacer qué.
 */
@Component({
  selector: 'app-inventario-requisiciones',
  imports: [RouterLink, FormDrawer, Skeleton],
  templateUrl: './requisiciones.html',
  styleUrl: './requisiciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Requisiciones implements OnInit {
  private service = inject(SolicitudesMaterialService);
  private bodegasService = inject(BodegasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  readonly formatFecha = formatFechaDisplay;
  // AT22 — created_at es timestamptz: fecha + hora exacta en lista y detalle.
  readonly formatTimestamp = formatFechaHoraDisplay;
  estadoBadge = (e: string) => ESTADO_BADGE[e] ?? 'neutral';
  estadoLabel = (e: string) => ESTADO_LABEL[e] ?? e;

  requisiciones = signal<SolicitudMaterial[]>([]);
  bodegas = signal<Bodega[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Filtros ──────────────────────────────────────────────
  fObra = signal('');
  fSolicitante = signal('');
  fEstado = signal('');
  fUrgencia = signal('');
  fDesde = signal('');
  fHasta = signal('');
  fArticulo = signal('');
  search = signal('');

  // ── Detalle / gestión ────────────────────────────────────
  selected = signal<SolicitudMaterial | null>(null);
  drawerOpen = signal(false);
  mode = signal<'ver' | 'aprobar' | 'rechazar'>('ver');
  bodegaId = signal<string>('');
  fecha = signal<string>(hoy());
  responsable = signal<string>('');
  observaciones = signal<string>('');
  rechazoNota = signal<string>('');
  saving = signal(false);
  actionError = signal('');

  /** Quién puede gestionar (mirror del gate del servidor). El ingeniero no llega aquí. */
  puedeGestionar = computed(() => this.userService.puedeVerTodasRequisiciones());

  obrasDisponibles = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.requisiciones()) {
      if (r.proyecto_id) map.set(r.proyecto_id, r.proyecto?.nombre ?? '—');
    }
    return [...map.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  solicitantesDisponibles = computed(() => {
    const map = new Map<string, string>();
    for (const r of this.requisiciones()) {
      if (r.solicitante_id) map.set(r.solicitante_id, r.solicitante?.nombre ?? '—');
    }
    return [...map.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  /** Almacenes de la obra seleccionada en el detalle (para prellenar el despacho). */
  bodegasDeObra = computed(() => {
    const pid = this.selected()?.proyecto_id;
    if (!pid) return this.bodegas();
    const propias = this.bodegas().filter((b) => b.proyecto_id === pid);
    return propias.length ? propias : this.bodegas();
  });

  pendientesCount = computed(
    () => this.requisiciones().filter((r) => r.estado === 'pendiente').length,
  );

  hasActiveFilters = computed(
    () =>
      !!this.fObra() ||
      !!this.fSolicitante() ||
      !!this.fEstado() ||
      !!this.fUrgencia() ||
      !!this.fDesde() ||
      !!this.fHasta() ||
      !!this.fArticulo() ||
      !!this.search(),
  );

  filtered = computed(() => {
    const obra = this.fObra();
    const sol = this.fSolicitante();
    const est = this.fEstado();
    const urg = this.fUrgencia();
    const desde = this.fDesde();
    const hasta = this.fHasta();
    const art = this.fArticulo().trim().toLowerCase();
    const q = this.search().trim().toLowerCase();

    return this.requisiciones().filter((r) => {
      if (obra && r.proyecto_id !== obra) return false;
      if (sol && r.solicitante_id !== sol) return false;
      if (est && r.estado !== est) return false;
      if (urg && r.urgencia !== urg) return false;
      // created_at es ISO; comparo por prefijo YYYY-MM-DD para no romper zonas horarias.
      const fecha = (r.created_at ?? '').slice(0, 10);
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      if (art && !(r.items ?? []).some((i) => (i.descripcion ?? '').toLowerCase().includes(art)))
        return false;
      if (q) {
        const hay = [
          r.proyecto?.nombre,
          r.solicitante?.nombre,
          r.notas,
          ...(r.items ?? []).map((i) => i.descripcion),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  async ngOnInit() {
    const obra = this.route.snapshot.queryParamMap.get('obra');
    if (obra) this.fObra.set(obra);
    await this.loadAll();
    // AS6 — deep-link desde el email (?req=<id>): abre directamente esa requisición.
    const reqId = this.route.snapshot.queryParamMap.get('req');
    if (reqId) {
      const it = this.requisiciones().find((r) => r.id === reqId);
      if (it) this.abrir(it);
    }
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [reqs, bodegas] = await Promise.all([
        this.service.getAll(),
        this.bodegasService.getAll(),
      ]);
      this.requisiciones.set(reqs);
      this.bodegas.set(bodegas.filter((b) => b.activo !== false));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar las requisiciones.');
    } finally {
      this.loading.set(false);
    }
  }

  itemsCount(r: SolicitudMaterial): number {
    return (r.items ?? []).length;
  }

  // ── Detalle ───────────────────────────────────────────────
  abrir(r: SolicitudMaterial) {
    this.selected.set(r);
    this.mode.set('ver');
    this.actionError.set('');
    this.rechazoNota.set('');
    this.responsable.set('');
    this.observaciones.set('');
    this.fecha.set(hoy());
    // Prefill del almacén con el de la obra (si tiene) o el primero activo.
    const pid = r.proyecto_id;
    const propia = this.bodegas().find((b) => b.proyecto_id === pid);
    this.bodegaId.set(propia?.id ?? this.bodegas()[0]?.id ?? '');
    this.drawerOpen.set(true);
  }

  cerrar() {
    this.drawerOpen.set(false);
  }

  iniciarAprobar() {
    this.actionError.set('');
    this.mode.set('aprobar');
  }
  iniciarRechazar() {
    this.actionError.set('');
    this.mode.set('rechazar');
  }
  volverVer() {
    this.actionError.set('');
    this.mode.set('ver');
  }

  async confirmarAprobar() {
    const s = this.selected();
    if (!s || this.saving()) return;
    if (!this.bodegaId()) {
      this.actionError.set('Elige el almacén desde el que se despacha.');
      return;
    }
    if (!this.fecha()) {
      this.actionError.set('Indica la fecha del despacho.');
      return;
    }
    this.saving.set(true);
    this.actionError.set('');
    try {
      const res = await this.service.aprobarRequisicion(s.id, {
        bodega_id: this.bodegaId(),
        fecha: this.fecha(),
        responsable: this.responsable().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: (s.items ?? []).map((i) => ({
          articulo_id: i.articulo_id,
          descripcion: i.descripcion,
          unidad: i.unidad,
          cantidad: i.cantidad,
          talla: i.talla ?? null,
        })),
      });
      const partes: string[] = [];
      if (res.despachado_total > 0) partes.push('despacho generado');
      if (res.solicitud_compra_id) partes.push('compra automática por el faltante');
      this.toast.success(
        'Requisición aprobada',
        partes.length ? partes.join(' + ') : undefined,
      );
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al aprobar la requisición.';
      this.actionError.set(msg);
      this.toast.error('No se pudo aprobar', msg);
    } finally {
      this.saving.set(false);
    }
  }

  async confirmarRechazar() {
    const s = this.selected();
    if (!s || this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.service.rechazar(s.id, this.rechazoNota().trim() || null);
      this.toast.info('Requisición rechazada');
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al rechazar la requisición.';
      this.actionError.set(msg);
      this.toast.error('No se pudo rechazar', msg);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Filtros helpers ───────────────────────────────────────
  clearFilters() {
    this.fObra.set('');
    this.fSolicitante.set('');
    this.fEstado.set('');
    this.fUrgencia.set('');
    this.fDesde.set('');
    this.fHasta.set('');
    this.fArticulo.set('');
    this.search.set('');
  }

  async exportar() {
    const rows = this.filtered().map((r) => ({
      Fecha: this.formatFecha(r.created_at),
      Obra: r.proyecto?.nombre ?? '',
      Solicitante: r.solicitante?.nombre ?? '',
      Urgencia: r.urgencia === 'urgente' ? 'Urgente' : 'Normal',
      Artículos: this.itemsCount(r),
      Estado: this.estadoLabel(r.estado),
      Notas: r.notas ?? '',
    }));
    await exportarExcel('requisiciones', rows);
  }
}
