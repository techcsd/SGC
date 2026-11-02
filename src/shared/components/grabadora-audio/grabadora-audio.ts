import { Component, ChangeDetectionStrategy, output, signal } from '@angular/core';
import { Icon } from '../../ui/icon/icon';
import { TranslatePipe } from '../../i18n/translate.pipe';

/**
 * DF1-A — grabadora de audio EFEMERA (no persiste nada por sí sola): graba con
 * el micrófono y emite el Blob resultante vía `grabado`. Pensada para flujos
 * que mandan el audio a una edge function en el momento (modo rápido de
 * bitácora) en vez de guardarlo como una nota de voz permanente — para eso ya
 * existe `<app-audio-notas>`.
 */
@Component({
  selector: 'app-grabadora-audio',
  imports: [Icon, TranslatePipe],
  templateUrl: './grabadora-audio.html',
  styleUrl: './grabadora-audio.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrabadoraAudio {
  grabado = output<Blob>();

  grabando = signal(false);
  segundos = signal(0);
  error = signal('');
  tieneAudio = signal(false);

  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private inicio = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  async toggle() {
    if (this.grabando()) {
      this.mediaRecorder?.stop();
      return;
    }
    this.error.set('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('Tu navegador no permite grabar audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      const mr = new MediaRecorder(stream);
      this.mediaRecorder = mr;
      this.inicio = performance.now();
      mr.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.grabando.set(false);
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        const blob = new Blob(this.chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          this.tieneAudio.set(true);
          this.grabado.emit(blob);
        }
      };
      mr.start();
      this.grabando.set(true);
      this.segundos.set(0);
      this.timer = setInterval(() => this.segundos.update((s) => s + 1), 1000);
    } catch {
      this.error.set('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
    }
  }

  reiniciar() {
    this.tieneAudio.set(false);
    this.segundos.set(0);
  }
}
