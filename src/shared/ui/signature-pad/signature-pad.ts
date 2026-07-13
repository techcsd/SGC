import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  input,
  signal,
  AfterViewInit,
} from '@angular/core';

/**
 * Pad de firma manuscrita sobre <canvas> (pointer events, sin dependencias).
 * El padre obtiene la firma con toBlob(); isEmpty() indica si aún no se ha dibujado.
 * Uso legal (CSD-OPE-01 §6.8): captura de firmas del ciclo de liberación.
 */
@Component({
  selector: 'app-signature-pad',
  templateUrl: './signature-pad.html',
  styleUrl: './signature-pad.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignaturePad implements AfterViewInit {
  canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  ariaLabel = input<string>('Área de firma');

  empty = signal(true);
  private drawing = false;
  private ctx: CanvasRenderingContext2D | null = null;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    // Escala por devicePixelRatio para trazo nítido.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a1a';
    this.ctx = ctx;
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  onPointerDown(e: PointerEvent): void {
    if (!this.ctx) return;
    e.preventDefault();
    this.canvasRef().nativeElement.setPointerCapture(e.pointerId);
    this.drawing = true;
    const { x, y } = this.pos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.drawing || !this.ctx) return;
    e.preventDefault();
    const { x, y } = this.pos(e);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    if (this.empty()) this.empty.set(false);
  }

  onPointerUp(): void {
    this.drawing = false;
  }

  clear(): void {
    const canvas = this.canvasRef().nativeElement;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.empty.set(true);
  }

  isEmpty(): boolean {
    return this.empty();
  }

  /** Devuelve la firma como PNG (fondo transparente) o null si está vacía. */
  toBlob(): Promise<Blob | null> {
    if (this.empty()) return Promise.resolve(null);
    return new Promise((resolve) =>
      this.canvasRef().nativeElement.toBlob((b) => resolve(b), 'image/png'),
    );
  }
}
