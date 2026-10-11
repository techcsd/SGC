import { Component, ChangeDetectionStrategy, inject, input, output, signal, viewChild, ElementRef, OnInit } from '@angular/core';
import { SupabaseService } from '../../../app/core/services/supabase.service';

interface Capitulo { t: number; label: string; }

/**
 * CM3 — Reproductor "teatro" (modal tipo YouTube) para los videos de Dudas. Video 16:9
 * grande con controles nativos (play, sonido, tiempo, velocidad, pantalla completa),
 * subtítulos (CC) desde el .vtt, capítulos a la derecha (clic = salta) y "¿Te sirvió?".
 * Esc cierra y devuelve el foco. (Sustituye el video de 210px dentro de la tarjeta.)
 */
@Component({
  selector: 'app-video-teatro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './video-teatro.html',
  styleUrl: './video-teatro.scss',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class VideoTeatro implements OnInit {
  src = input.required<string>();
  vtt = input<string | null>(null);
  poster = input<string | null>(null);
  titulo = input<string>('Video');
  /** id/slug de la guía (para guardar "¿te sirvió?"). */
  slug = input<string>('');

  closed = output<void>();

  private supabase = inject(SupabaseService);
  private videoEl = viewChild<ElementRef<HTMLVideoElement>>('video');

  capitulos = signal<Capitulo[]>([]);
  feedback = signal<boolean | null>(null);
  feedbackGuardado = signal(false);
  ocupado = signal(false);

  /** Nombre de archivo amigable para descargar/compartir. */
  private nombreArchivo(): string {
    const base = (this.titulo() || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'video';
    return `SGC-${base}.mp4`;
  }

  /** ¿El navegador puede compartir archivos (móvil → WhatsApp, etc.)? */
  puedeCompartir(): boolean {
    const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean };
    return typeof nav.share === 'function' && typeof nav.canShare === 'function';
  }

  private async bajarBlob(): Promise<Blob> {
    const res = await fetch(this.src(), { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo obtener el video');
    return res.blob();
  }

  /** Descarga el mp4 al dispositivo. */
  async descargar() {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const blob = await this.bajarBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = this.nombreArchivo();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      // Respaldo: abre el video en otra pestaña para guardarlo manualmente.
      window.open(this.src(), '_blank');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Comparte el video (WhatsApp y demás) usando la hoja de compartir del sistema. */
  async compartir() {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const nav = navigator as Navigator & { canShare?: (d?: unknown) => boolean; share: (d: unknown) => Promise<void> };
      const blob = await this.bajarBlob();
      const file = new File([blob], this.nombreArchivo(), { type: 'video/mp4' });
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: this.titulo(), text: `Tutorial: ${this.titulo()} — SGC` });
      } else {
        // Sin compartir archivos → comparte el enlace.
        await nav.share({ title: this.titulo(), text: `Tutorial: ${this.titulo()} — SGC`, url: this.src() });
      }
    } catch {
      /* el usuario canceló o no se pudo compartir */
    } finally {
      this.ocupado.set(false);
    }
  }

  async ngOnInit() {
    const vttUrl = this.vtt();
    if (vttUrl) {
      try {
        const txt = await (await fetch(vttUrl, { cache: 'no-store' })).text();
        this.capitulos.set(this.parseVtt(txt));
      } catch { /* sin capítulos, el video igual se ve */ }
    }
  }

  /** Parsea los cues del WEBVTT → capítulos (inicio + texto de la 1.ª línea). */
  private parseVtt(txt: string): Capitulo[] {
    const caps: Capitulo[] = [];
    const bloques = txt.replace(/\r/g, '').split('\n\n');
    for (const b of bloques) {
      const m = b.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->/);
      if (!m) continue;
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      const label = b.split('\n').find((l) => l && !l.includes('-->') && !/^\d+$/.test(l.trim()) && l.trim() !== 'WEBVTT') ?? '';
      if (label) caps.push({ t, label: label.trim() });
    }
    return caps;
  }

  saltarA(t: number) {
    const v = this.videoEl()?.nativeElement;
    if (v) { v.currentTime = t; void v.play(); }
  }

  fmt(t: number): string {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async marcar(util: boolean) {
    this.feedback.set(util);
    const slug = this.slug();
    if (!slug) { this.feedbackGuardado.set(true); return; }
    try {
      await this.supabase.client.rpc('ayuda_feedback_set', { p_slug: slug, p_util: util });
      this.feedbackGuardado.set(true);
    } catch { this.feedbackGuardado.set(true); /* best-effort */ }
  }
}
