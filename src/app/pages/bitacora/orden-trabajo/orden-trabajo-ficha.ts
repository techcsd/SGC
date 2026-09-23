import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { OrdenTrabajoPdfService } from '../../../../shared/services/orden-trabajo-pdf.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { OrdenTrabajoDetalle } from '../../../../shared/models/bitacora.model';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/**
 * BN1/BW1 — Ficha de una orden de trabajo: detalle + las dos firmas (ingeniero y
 * cliente), número visible OT-000123, chip de estado (borrador/emitida/firmada) y
 * barra de acciones: Imprimir/PDF (plantilla única en el padre), Copiar enlace,
 * Enviar a… (usuarios del sistema → aviso) y Compartir (Web Share API).
 * Cumple AT11: toda la data enviada (firmas, monto, descripción) se ve aquí.
 */
@Component({
  selector: 'app-orden-trabajo-ficha',
  imports: [DatePipe, DecimalPipe, RouterLink, UserPicker, TranslatePipe],
  templateUrl: './orden-trabajo-ficha.html',
  styleUrl: './orden-trabajo-ficha.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdenTrabajoFicha implements OnInit {
  private route = inject(ActivatedRoute);
  private bitacoraService = inject(BitacoraService);
  private pdf = inject(OrdenTrabajoPdfService);
  private toast = inject(ToastService);

  loading = signal(true);
  error = signal('');
  orden = signal<OrdenTrabajoDetalle | null>(null);
  bitacoraId = signal<string>('');
  /** URL firmada por rol para pintar las firmas. */
  firmaUrls = signal<Record<string, string>>({});

  firmaIng = computed(() => this.orden()?.firmas.find((fi) => fi.rol === 'ingeniero') ?? null);
  firmaCli = computed(() => this.orden()?.firmas.find((fi) => fi.rol === 'cliente') ?? null);

  /** BW1 — número visible OT-000123. */
  codigo = computed(() => this.pdf.codigo(this.orden()?.detalle?.numero));

  /** BW1 — estado derivado de las firmas (paridad con listar_ordenes_trabajo). */
  estado = computed<'borrador' | 'emitida' | 'firmada'>(() => {
    const firmas = this.orden()?.firmas ?? [];
    const ing = firmas.some((f) => f.rol === 'ingeniero');
    const cli = firmas.some((f) => f.rol === 'cliente');
    if (ing && cli) return 'firmada';
    if (ing) return 'emitida';
    return 'borrador';
  });
  readonly ESTADO_LABEL: Record<string, string> = {
    borrador: 'Borrador', emitida: 'Emitida', firmada: 'Firmada',
  };

  // BW1 — "Enviar a…": chips de destinatarios + panel.
  enviarAbierto = signal(false);
  destinatarios = signal<{ id: string; nombre: string }[]>([]);
  enviando = signal(false);

  private enlace = computed(() => `${window.location.origin}/bitacora/orden-trabajo/${this.bitacoraId()}`);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error.set('Orden no encontrada.'); this.loading.set(false); return; }
    this.bitacoraId.set(id);
    try {
      const data = await this.bitacoraService.getOrdenTrabajo(id);
      if (!data || !data.bitacora) { this.error.set('No se encontró la orden o no tienes acceso.'); return; }
      this.orden.set(data);
      const urls: Record<string, string> = {};
      for (const fi of data.firmas) {
        try { urls[fi.rol] = await this.bitacoraService.getSignedUrl(fi.firma_path); } catch { /* firma opcional */ }
      }
      this.firmaUrls.set(urls);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la orden de trabajo.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Imprimir / PDF — usa la plantilla única del padre (AU1). */
  async imprimir() {
    const o = this.orden();
    if (!o) return;
    await this.pdf.abrirImprimible(o, this.firmaUrls());
  }

  async copiarEnlace() {
    try {
      await navigator.clipboard.writeText(this.enlace());
      this.toast.success('Enlace copiado.', 'Pégalo donde quieras compartir esta orden.');
    } catch {
      this.toast.error('No se pudo copiar el enlace.');
    }
  }

  /** Web Share API si existe; comparte el enlace a la ficha. */
  async compartir() {
    const cod = this.codigo();
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: `Orden de trabajo ${cod}`, text: `Orden de trabajo ${cod}`, url: this.enlace() });
        return;
      } catch { /* cancelado por el usuario */ return; }
    }
    // Sin Web Share (escritorio): caemos a copiar el enlace.
    await this.copiarEnlace();
  }

  toggleEnviar() {
    this.enviarAbierto.update((v) => !v);
  }

  onDestinatarioPicked(sel: UserPickerSelection) {
    if (!sel.usuario_id) return;
    if (this.destinatarios().some((d) => d.id === sel.usuario_id)) return;
    this.destinatarios.update((list) => [...list, { id: sel.usuario_id!, nombre: sel.nombre }]);
  }

  removeDestinatario(id: string) {
    this.destinatarios.update((list) => list.filter((d) => d.id !== id));
  }

  async enviar() {
    const ids = this.destinatarios().map((d) => d.id);
    if (!ids.length || this.enviando()) { return; }
    this.enviando.set(true);
    try {
      await this.bitacoraService.compartirOrdenTrabajo(this.bitacoraId(), ids);
      this.toast.success('Orden compartida.', `Se avisó a ${ids.length} ${ids.length === 1 ? 'persona' : 'personas'} con el enlace.`);
      this.destinatarios.set([]);
      this.enviarAbierto.set(false);
    } catch (e: unknown) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo compartir.');
    } finally {
      this.enviando.set(false);
    }
  }
}
