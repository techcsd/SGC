import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  VehiculosService,
  VehiculoEntrega,
  VehiculoAsignado,
} from '../../../../shared/services/vehiculos.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { MiniMapa } from '../../../../shared/components/mini-mapa/mini-mapa';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Img } from '../../../../shared/components/img/img';
import { RegistrarEntrega } from './registrar-entrega/registrar-entrega';
import { UserService } from '../../../core/services/user.service';
import { Vehiculo, identificacionVehiculo, unidadUso } from '../../../../shared/models/vehiculo.model';
import { VehiculoStats } from '../../../../shared/models/vehiculo-asignacion.model';

type RespTab = 'uso' | 'historial';

/** Estado de uso derivado de un vehículo (para la tarjeta del panel «En uso»). */
interface EstadoUso {
  clave: 'uso' | 'mantenimiento' | 'libre';
  nombre?: string;
  motivo?: 'custodia' | 'asignacion';
}

/**
 * AT10 — Panel «Vehículos en uso»: rejilla visual de la flota que muestra, de un
 * vistazo, quién tiene cada vehículo ahora mismo (custodia abierta o asignación).
 * El feed de entregas/devoluciones (evidencia legal de custodia) se conserva bajo
 * la segunda pestaña «Historial», con su registro de entrega/recepción intacto.
 */
@Component({
  selector: 'app-flota-responsabilidad',
  imports: [DecimalPipe, DatePipe, RouterLink, Skeleton, MiniMapa, FormDrawer, Img, RegistrarEntrega],
  templateUrl: './responsabilidad.html',
  styleUrl: './responsabilidad.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Responsabilidad implements OnInit {
  private vehiculosService = inject(VehiculosService);
  private userService = inject(UserService);

  // Helpers de plantilla.
  readonly ident = identificacionVehiculo;
  readonly unidad = unidadUso;

  tab = signal<RespTab>('uso');

  // ── Datos del panel «En uso» ──
  vehiculos = signal<Vehiculo[]>([]);
  asignados = signal<Map<string, VehiculoAsignado>>(new Map());
  private stats = signal<Record<string, VehiculoStats>>({});
  private fotoGrid = signal<Record<string, string>>({});
  usoSearch = signal('');

  // ── Datos del «Historial» de entregas ──
  entregas = signal<VehiculoEntrega[]>([]);

  loading = signal(true);
  error = signal('');
  dbNotReady = signal(false);

  searchQuery = signal('');
  soloRevision = signal(false);
  drawerOpen = signal(false);

  expandedId = signal<string | null>(null);
  // entrega_id → (slot → signed url)
  private fotoUrls = signal<Record<string, Record<string, string>>>({});

  private esAdmin = computed(() => this.userService.hasRole('admin'));

  /** Flota mostrable en la rejilla: sin bajas y sin datos de prueba (salvo admin). */
  private baseUso = computed(() => {
    const admin = this.esAdmin();
    return this.vehiculos().filter((v) => {
      if (v.estado === 'baja') return false;
      if (v.es_prueba && !admin) return false;
      return true;
    });
  });

  vehiculosUso = computed(() => {
    const q = this.usoSearch().toLowerCase().trim();
    const base = this.baseUso();
    if (!q) return base;
    return base.filter((v) => this.ident(v).toLowerCase().includes(q));
  });

  // Contadores del encabezado (sobre la flota mostrable, no sobre el buscador).
  totalCount = computed(() => this.baseUso().length);
  enUsoCount = computed(() => {
    const map = this.asignados();
    return this.baseUso().filter((v) => map.has(v.id)).length;
  });
  mantenimientoCount = computed(() => {
    const map = this.asignados();
    return this.baseUso().filter((v) => !map.has(v.id) && v.estado === 'mantenimiento').length;
  });
  libresCount = computed(() => {
    const map = this.asignados();
    return this.baseUso().filter((v) => !map.has(v.id) && v.estado !== 'mantenimiento').length;
  });

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const soloRev = this.soloRevision();
    return this.entregas().filter((e) => {
      if (soloRev && !e.requiere_revision) return false;
      if (!q) return true;
      const placa = e.vehiculo?.placa?.toLowerCase() ?? '';
      const conductor = e.conductor?.nombre?.toLowerCase() ?? '';
      return placa.includes(q) || conductor.includes(q);
    });
  });

  revisionCount = computed(() => this.entregas().filter((e) => e.requiere_revision).length);

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    this.dbNotReady.set(false);
    try {
      const [vehiculos, asignados, stats, entregas] = await Promise.all([
        this.vehiculosService.getAll(),
        this.vehiculosService.getVehiculosAsignados(),
        this.vehiculosService.getStatsAll(),
        this.vehiculosService.getResponsabilidad(),
      ]);
      this.vehiculos.set(vehiculos);
      this.asignados.set(asignados);
      const sm: Record<string, VehiculoStats> = {};
      for (const s of stats) sm[s.vehiculo_id] = s;
      this.stats.set(sm);
      this.entregas.set(entregas);
      this.resolverFotosGrid(vehiculos);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('permission denied')) {
        this.dbNotReady.set(true);
      } else {
        this.error.set(msg || 'Error al cargar la información.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  /** Resuelve la foto de portada (fallback 1ª) de cada vehículo a URL firmada. */
  private resolverFotosGrid(vehiculos: Vehiculo[]) {
    for (const v of vehiculos) {
      const first = v.foto_portada ?? v.fotos?.[0];
      if (!first) continue;
      this.vehiculosService.getFotoUrl(first, { width: 800, quality: 75 }).then((url) => {
        if (url) this.fotoGrid.update((m) => ({ ...m, [v.id]: url }));
      });
    }
  }

  fotoDe(v: Vehiculo): string | null {
    return this.fotoGrid()[v.id] ?? null;
  }

  statsDe(v: Vehiculo): VehiculoStats | null {
    return this.stats()[v.id] ?? null;
  }

  /** Quién tiene el vehículo ahora + en qué estado está (para la píldora). */
  estadoUso(v: Vehiculo): EstadoUso {
    const a = this.asignados().get(v.id);
    if (a) return { clave: 'uso', nombre: a.nombre, motivo: a.motivo };
    if (v.estado === 'mantenimiento') return { clave: 'mantenimiento' };
    return { clave: 'libre' };
  }

  setTab(t: RespTab) {
    this.tab.set(t);
  }

  onUsoSearch(value: string) {
    this.usoSearch.set(value);
  }

  /** Salta al Historial filtrado por este vehículo (por placa, la clave del buscador). */
  verHistorial(v: Vehiculo) {
    this.searchQuery.set(v.placa ?? '');
    this.tab.set('historial');
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  abrirRegistro() {
    this.drawerOpen.set(true);
  }
  cerrarRegistro() {
    this.drawerOpen.set(false);
  }
  async onCreada() {
    this.drawerOpen.set(false);
    await this.load();
  }

  toggleRevision() {
    this.soloRevision.update((v) => !v);
  }

  async toggle(entrega: VehiculoEntrega) {
    if (this.expandedId() === entrega.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(entrega.id);
    if (!this.fotoUrls()[entrega.id]) {
      await this.resolveFotos(entrega);
    }
  }

  private async resolveFotos(entrega: VehiculoEntrega) {
    const map: Record<string, string> = {};
    const items = [
      ...(entrega.fotos ?? []).map((f) => ({ key: f.slot, path: f.storage_path })),
      ...(entrega.danos ?? []).map((d, i) => ({ key: `dano_${i}`, path: d.foto_path })),
      // The receiver's signature — legal custody evidence, was never shown before.
      ...(entrega.firma_url ? [{ key: '__firma', path: entrega.firma_url }] : []),
    ];
    await Promise.all(
      items.map(async (it) => {
        try {
          map[it.key] = await this.vehiculosService.getEntregaFotoUrl(it.path);
        } catch {
          /* skip a photo that can't be signed */
        }
      }),
    );
    this.fotoUrls.update((all) => ({ ...all, [entrega.id]: map }));
  }

  /** Checklist photos (excludes the signature, which renders on its own). */
  fotosDe(entregaId: string): { key: string; url: string }[] {
    const map = this.fotoUrls()[entregaId] ?? {};
    return Object.entries(map)
      .filter(([key]) => key !== '__firma')
      .map(([key, url]) => ({ key, url }));
  }

  firmaDe(entregaId: string): string | null {
    return this.fotoUrls()[entregaId]?.['__firma'] ?? null;
  }

  isExpanded(id: string): boolean {
    return this.expandedId() === id;
  }
}
