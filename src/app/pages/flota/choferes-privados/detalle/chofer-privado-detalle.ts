import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ChoferesPrivadosService, ChoferPrivadoDetalle as ChoferPrivadoDetalleData } from '../../../../../shared/services/choferes-privados.service';
import { Skeleton } from '../../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../../shared/ui/icon/icon';
import { Lightbox } from '../../../../../shared/ui/lightbox/lightbox';
import { formatearCedula } from '../../../../../shared/utils/cedula.util';
import { formatearTelefono } from '../../../../../shared/utils/telefono.util';
import { formatFechaDisplay, formatFechaHoraDisplay } from '../../../../../shared/utils/fecha.util';

/**
 * CK1/CK2 — Flota › Choferes privados › ficha. Cadena de responsabilidad completa de un
 * chofer privado: vigencias de vehículos autorizados, historial de usos (tomó/soltó/recibió),
 * entregas/recepciones con fotos, echadas de combustible (con foto y origen) e inspecciones.
 * Solo lectura; los datos llegan del RPC definer chofer_privado_detalle. Gate: flota elevado.
 */
@Component({
  selector: 'app-chofer-privado-detalle',
  imports: [DecimalPipe, RouterLink, Skeleton, Icon, Lightbox],
  templateUrl: './chofer-privado-detalle.html',
  styleUrl: './chofer-privado-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChoferPrivadoDetalle implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(ChoferesPrivadosService);

  readonly fmtCedula = formatearCedula;
  readonly fmtTelefono = formatearTelefono;
  readonly fmtFecha = formatFechaDisplay;
  readonly fmtFechaHora = formatFechaHoraDisplay;

  cargando = signal(true);
  error = signal('');
  data = signal<ChoferPrivadoDetalleData | null>(null);
  fotoUrls = signal<Record<string, string>>({});
  lightbox = signal<string | null>(null);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) { this.error.set('Falta el chofer.'); this.cargando.set(false); return; }
    try {
      const d = await this.service.detalle(id);
      this.data.set(d);
      void this.resolverFotos(d);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la ficha.');
    } finally {
      this.cargando.set(false);
    }
  }

  /** Resuelve las URLs firmadas de todas las fotos (entregas + echadas) en segundo plano. */
  private async resolverFotos(d: ChoferPrivadoDetalleData) {
    const paths = new Set<string>();
    for (const e of d.entregas) for (const p of e.fotos ?? []) paths.add(p);
    for (const r of d.echadas) { if (r.foto_recibo_path) paths.add(r.foto_recibo_path); if (r.foto_tablero_path) paths.add(r.foto_tablero_path); }
    await Promise.all([...paths].map(async (p) => {
      const url = await this.service.fotoUrl(p).catch(() => null);
      if (url) this.fotoUrls.update((m) => ({ ...m, [p]: url }));
    }));
  }

  thumb(path: string | null | undefined): string | null {
    return path ? (this.fotoUrls()[path] ?? null) : null;
  }

  abrirFoto(path: string | null | undefined) {
    const url = this.thumb(path);
    if (url) this.lightbox.set(url);
  }

  vehiculoLabel(placa: string | null, marca?: string | null, modelo?: string | null): string {
    return placa || [marca, modelo].filter(Boolean).join(' ') || 'Vehículo';
  }
}
