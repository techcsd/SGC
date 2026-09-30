import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { TransporteV3Service, ConduceExternoDetalle } from '../../../../shared/services/transporte-v3.service';

/**
 * CC5 — Ficha (detalle completo) del conduce externo: CE-000123, transportista,
 * origen→destino, renglones (si afecta inventario), firmas, fotos, historial de
 * estados. Imprimible/PDF con la misma plantilla del conduce normal (window.print
 * + estilos de impresión), compartir por enlace/WhatsApp, y anular con motivo.
 */
@Component({
  selector: 'app-conduce-externo-ficha',
  imports: [DatePipe, RouterLink],
  templateUrl: './conduce-externo-ficha.html',
  styleUrl: './conduce-externo-ficha.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConduceExternoFicha implements OnInit {
  private route = inject(ActivatedRoute);
  private supabase = inject(SupabaseService);
  private svc = inject(TransporteV3Service);
  private toast = inject(ToastService);

  loading = signal(true);
  error = signal('');
  detalle = signal<ConduceExternoDetalle | null>(null);

  placaUrl = signal<string | null>(null);
  cargaUrl = signal<string | null>(null);
  recepcionUrl = signal<string | null>(null);
  emisorFirmaUrl = signal<string | null>(null);
  receptorFirmaUrl = signal<string | null>(null);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error.set('Conduce no especificado.'); this.loading.set(false); return; }
    try {
      const d = await this.svc.conduceExternoDetalle(id);
      this.detalle.set(d);
      await this.cargarFotos(d);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el conduce externo.');
    } finally {
      this.loading.set(false);
    }
  }

  private async firma(bucket: string, path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.supabase.client.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  private async cargarFotos(d: ConduceExternoDetalle) {
    // Las fotos del transporte viven en el bucket `conduces` (igual que el conduce normal).
    this.placaUrl.set(await this.firma('conduces', d.placa_foto_path));
    this.cargaUrl.set(await this.firma('conduces', d.carga_foto_path));
    this.recepcionUrl.set(await this.firma('conduces', d.recepcion_foto_path));
    this.emisorFirmaUrl.set(await this.firma('conduces', d.emisor_firma_path));
    this.receptorFirmaUrl.set(await this.firma('conduces', d.receptor_firma_path));
  }

  estadoLabel(e: string): string {
    return e === 'recibido' ? 'Recibido' : e === 'anulado' ? 'Anulado' : 'Emitido';
  }
  histLabel(e: string): string {
    return e === 'recibido' ? 'Recibido' : e === 'anulado' ? 'Anulado' : 'Emitido';
  }

  imprimir() { window.print(); }

  async compartir() {
    const d = this.detalle();
    if (!d) return;
    const url = window.location.href;
    const texto = `Conduce externo ${d.codigo} — ${d.transporta ?? ''}`;
    try {
      if (navigator.share) { await navigator.share({ title: d.codigo, text: texto, url }); return; }
      await navigator.clipboard.writeText(url);
      this.toast.success('Enlace copiado');
    } catch { /* cancelado */ }
  }

  compartirWhatsapp() {
    const d = this.detalle();
    if (!d) return;
    const msg = encodeURIComponent(`Conduce externo ${d.codigo}\n${window.location.href}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  }

  async anular() {
    const d = this.detalle();
    if (!d || d.anulado) return;
    const motivo = window.prompt('Motivo de la anulación:');
    if (!motivo || !motivo.trim()) return;
    try {
      await this.svc.anularConduceExterno(d.id, motivo.trim());
      this.detalle.set({ ...d, anulado: true, estado: 'anulado', motivo_anulacion: motivo.trim() });
      this.toast.success('Conduce externo anulado');
    } catch (e) {
      this.toast.error('No se pudo anular', e instanceof Error ? e.message : undefined);
    }
  }
}
