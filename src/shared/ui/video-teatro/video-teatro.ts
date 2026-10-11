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
