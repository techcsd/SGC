import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BodegasService, AlmacenDuplicadoCandidato } from '../../../../shared/services/bodegas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';

/**
 * AY5 — Reporte de almacenes duplicados (fuzzy por nombre + misma obra). ⏸ La fusión
 * es irreversible-con-cuidado (mueve stock/movimientos/aperturas al canónico y
 * desactiva el duplicado), así que se presenta la lista para revisar ANTES de fusionar.
 */
@Component({
  selector: 'app-admin-almacenes-duplicados',
  imports: [Skeleton, DecimalPipe, Icon],
  templateUrl: './almacenes-duplicados.html',
  styleUrl: './almacenes-duplicados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAlmacenesDuplicados implements OnInit {
  private svc = inject(BodegasService);
  private toast = inject(ToastService);

  candidatos = signal<AlmacenDuplicadoCandidato[]>([]);
  loading = signal(true);
  fusionando = signal<string | null>(null);

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading.set(true);
    try {
      this.candidatos.set(await this.svc.getDuplicadosCandidatos());
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el reporte.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Fusiona `duplicado` en `canonico` tras confirmación explícita. */
  async fusionar(c: AlmacenDuplicadoCandidato, canonicoId: string, duplicadoId: string, canonicoNombre: string, duplicadoNombre: string) {
    const key = `${canonicoId}:${duplicadoId}`;
    if (this.fusionando()) return;
    if (!confirm(
      `Vas a FUSIONAR "${duplicadoNombre}" dentro de "${canonicoNombre}".\n\n` +
      `Se moverá todo el stock, aperturas y movimientos al canónico y el duplicado quedará desactivado. ` +
      `Esta acción es difícil de revertir.\n\n¿Continuar?`,
    )) return;
    this.fusionando.set(key);
    try {
      await this.svc.fusionar(canonicoId, duplicadoId);
      this.toast.success('Almacenes fusionados', `"${duplicadoNombre}" se fusionó en "${canonicoNombre}".`);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo fusionar.');
    } finally {
      this.fusionando.set(null);
    }
  }
}
