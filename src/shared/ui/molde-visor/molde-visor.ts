import { Component, ChangeDetectionStrategy, ElementRef, ViewChild, computed, effect, input, model, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MoldeEsquema, MoldeTramo } from '../molde-esquema/molde-esquema';
import { Icon } from '../icon/icon';
import { TranslatePipe } from '../../i18n/translate.pipe';

/** Item mínimo que necesita el visor — tanto `BitacoraMoldeOffice` (moldes.ts, con
 * su bitácora embebida) como `BitacoraMolde` (historial.ts, un molde suelto) se
 * mapean a esto antes de pasarlos. */
export interface MoldeVisorItem {
  forma?: string | null;
  tramos: MoldeTramo[];
  medidaPlano?: MoldeTramo[] | null;
  titulo?: string;
  obra?: string;
  fecha?: string;
  ingeniero?: string;
  /** Si se da, el visor ofrece "Abrir la bitácora de ese día". */
  bitacoraId?: string | null;
}

/**
 * DI2 — visor de esquema de molde a pantalla casi completa. Se abre desde el botón
 * "Ampliar" de `app-molde-esquema` (en Moldes o en el detalle de bitácora). Navega
 * entre varios moldes (← →), zoom (+/−), descarga PNG, imprime y enlaza a la
 * bitácora de origen. `<dialog>` nativo — Esc/click-afuera cierran solos.
 */
@Component({
  selector: 'app-molde-visor',
  imports: [RouterLink, MoldeEsquema, Icon, TranslatePipe, DecimalPipe],
  templateUrl: './molde-visor.html',
  styleUrl: './molde-visor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoldeVisor {
  open = input<boolean>(false);
  moldes = input<MoldeVisorItem[]>([]);
  index = model<number>(0);
  toleranciaCm = input<number>(2);
  closed = output<void>();

  @ViewChild('dlg') private dlgRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('svgHost') private svgHostRef?: ElementRef<HTMLDivElement>;

  zoom = signal(1);

  actual = computed<MoldeVisorItem | null>(() => this.moldes()[this.index()] ?? null);
  tieneVarios = computed(() => this.moldes().length > 1);

  private ultimoFoco: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const abrir = this.open();
      const dlg = this.dlgRef?.nativeElement;
      if (!dlg) return;
      if (abrir && !dlg.open) {
        this.ultimoFoco = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
        this.zoom.set(1);
        dlg.showModal();
      } else if (!abrir && dlg.open) {
        dlg.close();
      }
    });
  }

  /** Disparado por el evento nativo `close` del `<dialog>` (botón X, Esc, o `.close()`). */
  onDialogClose() {
    this.closed.emit();
    this.ultimoFoco?.focus?.();
    this.ultimoFoco = null;
  }

  cerrar() {
    this.dlgRef?.nativeElement?.close();
  }

  onBackdropClick(e: MouseEvent) {
    if (e.target === this.dlgRef?.nativeElement) this.cerrar();
  }

  onKeydown(e: KeyboardEvent) {
    if (!this.tieneVarios()) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.anterior(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.siguiente(); }
  }

  anterior() {
    const n = this.moldes().length;
    if (!n) return;
    this.index.set((this.index() - 1 + n) % n);
    this.zoom.set(1);
  }

  siguiente() {
    const n = this.moldes().length;
    if (!n) return;
    this.index.set((this.index() + 1) % n);
    this.zoom.set(1);
  }

  acercar() {
    this.zoom.update((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100));
  }

  alejar() {
    this.zoom.update((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  }

  /** Serializa el `<svg>` visible a PNG (canvas) y lo descarga. */
  descargarPng() {
    const svg = this.svgHostRef?.nativeElement?.querySelector('svg');
    if (!svg) return;
    const vb = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 420, 220];
    const w = vb[2] || 420;
    const h = vb[3] || 220;
    const escala = 3; // nitidez de exportación
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));

    const canvas = document.createElement('canvas');
    canvas.width = w * escala;
    canvas.height = h * escala;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        const nombre = (this.actual()?.titulo ?? 'esquema-molde').trim().replace(/\s+/g, '-');
        a.href = URL.createObjectURL(blob);
        a.download = `molde-${nombre}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = svg64;
  }

  /** Abre una ventana con solo el SVG e invoca print() — más simple y confiable
   * que pelear con @media print dentro de un <dialog>. */
  imprimir() {
    const svg = this.svgHostRef?.nativeElement?.querySelector('svg');
    if (!svg) return;
    const ventana = window.open('', '_blank', 'width=900,height=700');
    if (!ventana) return;
    const titulo = this.actual()?.titulo ?? 'Molde';
    ventana.document.write(
      `<html><head><title>${titulo}</title></head>` +
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;">` +
      svg.outerHTML +
      `</body></html>`,
    );
    ventana.document.close();
    ventana.focus();
    ventana.print();
  }
}
