import { Component, ChangeDetectionStrategy, computed, inject, signal, viewChild, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { SalidasService } from '../../../../shared/services/salidas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { SupabaseService } from '../../../../app/core/services/supabase.service';
import {
  SalidaInventario,
  SALIDA_ESTADO_LABELS,
  MOTIVOS_SALIDA,
  conduceNumero,
} from '../../../../shared/models/salida.model';
import { formatFechaDisplay, formatTimestampDisplay, todayIso } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { SignaturePad } from '../../../../shared/ui/signature-pad/signature-pad';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

interface ItemCierre {
  detalle_id: string;
  nombre: string;
  cantidad: number;
  cantidad_recibida: number;
}

@Component({
  selector: 'app-conduce',
  imports: [Skeleton, SignaturePad],
  templateUrl: './conduce.html',
  styleUrl: './conduce.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conduce implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private salidasService = inject(SalidasService);
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;
  formatTimestamp = formatTimestampDisplay;
  readonly hoy = todayIso();
  readonly numeroConduce: string;
  readonly ESTADO_LABELS = SALIDA_ESTADO_LABELS;

  salida = signal<SalidaInventario | null>(null);
  // La columna Talla solo se muestra si algún renglón la tiene (EPP) — así el
  // conduce de materiales normales queda limpio.
  mostrarTalla = computed(() => (this.salida()?.detalle_salidas ?? []).some((d) => !!d.talla));
  loading = signal(true);
  error = signal('');
  // Delivery evidence (photo + receiver signature) captured by the mobile app.
  entregaFotoUrl = signal<string | null>(null);
  entregaFirmaUrl = signal<string | null>(null);
  // Evidence photo taken when the salida itself was captured in the field.
  salidaFotoUrl = signal<string | null>(null);

  // ── Cierre de conduce por el chofer (paridad app de campo) ──
  mostrarCierre = signal(false);
  itemsCierre = signal<ItemCierre[]>([]);
  receptor = signal('');
  notasCierre = signal('');
  fotoCierreFile = signal<File | null>(null);
  fotoCierrePreview = signal<string | null>(null);
  guardandoCierre = signal(false);
  cierreError = signal('');
  private firmaPad = viewChild<SignaturePad>('firmaPad');

  puedeCerrar = computed(() => this.salida()?.estado === 'despachado');

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.numeroConduce = conduceNumero(id);
  }

  motivoLabel(motivo: string): string {
    return MOTIVOS_SALIDA.find((m) => m.value === motivo)?.label ?? motivo;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Salida no especificada.');
      this.loading.set(false);
      return;
    }
    try {
      const s = await this.salidasService.getById(id);
      this.salida.set(s);
      await this.loadEvidencia(s);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la salida.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve the private storage paths to time-limited signed URLs. Delivery
   *  evidence lives in the `conduces` bucket; the salida capture photo in
   *  `inventario`. */
  private async loadEvidencia(s: SalidaInventario) {
    const sign = async (bucket: string, path: string | null): Promise<string | null> => {
      if (!path) return null;
      const { data } = await this.supabase.client.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    };
    this.entregaFotoUrl.set(await sign('conduces', s.entrega_foto_path));
    this.entregaFirmaUrl.set(await sign('conduces', s.entrega_firma_path));
    this.salidaFotoUrl.set(await sign('inventario', s.foto_path));
  }

  // ── Cierre de conduce ──
  abrirCierre() {
    const s = this.salida();
    if (!s) return;
    this.receptor.set(s.responsable ?? '');
    this.notasCierre.set('');
    this.quitarFotoCierre();
    this.cierreError.set('');
    this.itemsCierre.set(
      (s.detalle_salidas ?? []).map((d) => ({
        detalle_id: d.id,
        nombre: d.articulo?.nombre ?? '—',
        cantidad: d.cantidad,
        cantidad_recibida: d.cantidad,
      })),
    );
    this.mostrarCierre.set(true);
  }

  cancelarCierre() {
    this.mostrarCierre.set(false);
  }

  updateRecibida(i: number, valor: string) {
    const n = Number(valor);
    this.itemsCierre.update((list) =>
      list.map((it, idx) => (idx === i ? { ...it, cantidad_recibida: isNaN(n) ? 0 : n } : it)),
    );
  }

  async onFotoCierre(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const comprimida = await comprimirImagen(file);
    const prev = this.fotoCierrePreview();
    if (prev) URL.revokeObjectURL(prev);
    this.fotoCierreFile.set(comprimida);
    this.fotoCierrePreview.set(URL.createObjectURL(comprimida));
  }

  quitarFotoCierre() {
    const prev = this.fotoCierrePreview();
    if (prev) URL.revokeObjectURL(prev);
    this.fotoCierreFile.set(null);
    this.fotoCierrePreview.set(null);
  }

  async confirmarCierre() {
    const s = this.salida();
    if (!s || this.guardandoCierre()) return;
    const receptor = this.receptor().trim();
    if (!receptor) {
      this.cierreError.set('Indica quién recibe el material.');
      return;
    }
    this.guardandoCierre.set(true);
    this.cierreError.set('');
    try {
      let firmaPath: string | null = null;
      const pad = this.firmaPad();
      if (pad && !pad.isEmpty()) {
        const blob = await pad.toBlob();
        if (blob) firmaPath = await this.salidasService.subirEvidenciaConduce(s.id, 'firma', blob, 'png');
      }
      let fotoPath: string | null = null;
      const foto = this.fotoCierreFile();
      if (foto) fotoPath = await this.salidasService.subirEvidenciaConduce(s.id, 'foto', foto, 'jpg');

      const items = this.itemsCierre().map((it) => ({
        detalle_id: it.detalle_id,
        cantidad_recibida: it.cantidad_recibida,
      }));
      await this.salidasService.entregarConduce(
        s.id,
        items,
        receptor,
        firmaPath,
        fotoPath,
        this.notasCierre().trim() || null,
      );

      // Recargar la salida + evidencia para reflejar el cierre.
      const fresca = await this.salidasService.getById(s.id);
      this.salida.set(fresca);
      await this.loadEvidencia(fresca);
      this.mostrarCierre.set(false);
      this.toast.success('Conduce entregado', 'Se registró la entrega con su evidencia.');
    } catch (e: unknown) {
      this.cierreError.set(e instanceof Error ? e.message : 'No se pudo registrar la entrega.');
    } finally {
      this.guardandoCierre.set(false);
    }
  }

  imprimir() {
    window.print();
  }

  /** Go back to wherever the user came from (Salidas, the Conduces list, or the
   *  engineer's Entregas page). Falls back to the dashboard on a direct hit. */
  volver() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
