import { ChangeDetectionStrategy, Component, computed, input, signal, OnDestroy } from '@angular/core';

/**
 * AY16 — reproductor de nota de voz estilo WhatsApp. Muestra la duración REAL
 * desde que el mensaje llega (metadata `duracion` = duracion_seg), sin esperar a
 * reproducir ni depender del header del blob webm/opus (que suele venir sin
 * duración). Play/pausa + barra de progreso + tiempo. No usa el control nativo
 * (feo y con 0:00/0:00 hasta reproducir).
 */
@Component({
  selector: 'app-voice-player',
  templateUrl: './voice-player.html',
  styleUrl: './voice-player.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoicePlayer implements OnDestroy {
  /** URL firmada del audio (null mientras se resuelve). */
  src = input<string | null>(null);
  /** Duración en segundos conocida al llegar (duracion_seg). */
  duracion = input<number | null>(null);
  /** true si la nota es mía (para el color de la barra). */
  mine = input<boolean>(false);

  private audio: HTMLAudioElement | null = null;
  playing = signal(false);
  private elapsed = signal(0);
  private realDur = signal(0); // duración leída del elemento (fallback)

  /** Total mostrado: la metadata si existe, si no la del elemento. */
  totalSeg = computed(() => {
    const d = this.duracion();
    if (d && d > 0) return d;
    return this.realDur();
  });

  /** Etiqueta: cuenta regresiva mientras suena, total en reposo. */
  label = computed(() => {
    const total = this.totalSeg();
    return this.playing() ? this.fmt(this.elapsed()) : this.fmt(total);
  });

  progreso = computed(() => {
    const total = this.totalSeg();
    if (!total) return 0;
    return Math.min(1, this.elapsed() / total);
  });

  toggle(): void {
    const url = this.src();
    if (!url) return;
    if (!this.audio) {
      const a = new Audio(url);
      a.preload = 'metadata';
      a.ontimeupdate = () => this.elapsed.set(a.currentTime);
      a.onloadedmetadata = () => {
        if (isFinite(a.duration) && a.duration > 0) this.realDur.set(a.duration);
      };
      a.onended = () => {
        this.playing.set(false);
        this.elapsed.set(0);
        a.currentTime = 0;
      };
      a.onpause = () => this.playing.set(false);
      a.onplay = () => this.playing.set(true);
      this.audio = a;
    }
    if (this.audio.paused) void this.audio.play().catch(() => this.playing.set(false));
    else this.audio.pause();
  }

  private fmt(seg: number): string {
    const s = Math.max(0, Math.round(seg));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
  }
}
