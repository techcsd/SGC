import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  VehiculosService,
  VehiculoEntrega,
} from '../../../../shared/services/vehiculos.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { MiniMapa } from '../../../../shared/components/mini-mapa/mini-mapa';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { RegistrarEntrega } from './registrar-entrega/registrar-entrega';

/**
 * Vehicle responsibility history captured by the CSD field app. Read-only
 * evidence: who had each vehicle, in what state, with photos + signature.
 * Returns flagged for review (new damage / anomalous km) are highlighted.
 */
@Component({
  selector: 'app-flota-responsabilidad',
  imports: [DecimalPipe, DatePipe, Skeleton, MiniMapa, FormDrawer, RegistrarEntrega],
  templateUrl: './responsabilidad.html',
  styleUrl: './responsabilidad.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Responsabilidad implements OnInit {
  private vehiculosService = inject(VehiculosService);

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
      this.entregas.set(await this.vehiculosService.getResponsabilidad());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('permission denied')) {
        this.dbNotReady.set(true);
      } else {
        this.error.set(msg || 'Error al cargar el historial.');
      }
    } finally {
      this.loading.set(false);
    }
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
