import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  effect,
} from '@angular/core';
import { AudioNotasService } from '../../services/audio-notas.service';
import { ToastService } from '../../services/toast.service';
import { AudioNota, AudioEntidadTipo, MAX_AUDIO_NOTAS } from '../../models/audio-nota.model';

/**
 * Z23c — Notas de voz transversales (reutilizable). Reproduce las N notas de voz
 * de un registro y permite grabar (MediaRecorder) o subir un audio, hasta el
 * límite (MAX_AUDIO_NOTAS). Se apoya en `AudioNotasService` + `sgc.audio_notas`.
 *
 * Uso: <app-audio-notas entidadTipo="mantenimiento" [entidadId]="m.id"
 *                        bucket="flota-documentos" [readOnly]="!puedeEditar()" />
 */
@Component({
  selector: 'app-audio-notas',
  imports: [],
  templateUrl: './audio-notas.html',
  styleUrl: './audio-notas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioNotas {
  entidadTipo = input.required<AudioEntidadTipo>();
  entidadId = input.required<string>();
  bucket = input<string>('sgc-bitacora');
  esPrueba = input<boolean>(false);
  readOnly = input<boolean>(false);

  private service = inject(AudioNotasService);
  private toast = inject(ToastService);

  readonly MAX = MAX_AUDIO_NOTAS;

  notas = signal<AudioNota[]>([]);
  urls = signal<Record<string, string>>({});
  loading = signal(false);
  busy = signal(false);
  grabando = signal(false);
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private grabInicio = 0;

  puedeAgregar = computed(() => !this.readOnly() && this.notas().length < this.MAX);

  constructor() {
    effect(() => {
      const id = this.entidadId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    try {
      const notas = await this.service.list(this.entidadTipo(), id);
      this.notas.set(notas);
      const entries = await Promise.all(
        notas.map(async (n) => [n.id, await this.service.signedUrl(n.bucket, n.path).catch(() => '')] as const),
      );
      const map: Record<string, string> = {};
      for (const [nid, url] of entries) if (url) map[nid] = url;
      this.urls.set(map);
    } catch {
      // best-effort: si falla, no bloquea el detalle.
    } finally {
      this.loading.set(false);
    }
  }

  urlOf(n: AudioNota): string | null {
    return this.urls()[n.id] ?? null;
  }

  // ── Grabar con el micrófono ────────────────────────────────
  async toggleGrabar() {
    if (this.grabando()) {
      this.mediaRecorder?.stop();
      return;
    }
    if (!this.puedeAgregar()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.toast.error('Grabación no disponible', 'Tu navegador no permite grabar audio; sube un archivo.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      const mr = new MediaRecorder(stream);
      this.mediaRecorder = mr;
      this.grabInicio = performance.now();
      mr.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        this.grabando.set(false);
        const blob = new Blob(this.chunks, { type: mr.mimeType || 'audio/webm' });
        const dur = Math.round((performance.now() - this.grabInicio) / 1000);
        if (blob.size > 0) await this.guardar(blob, dur);
      };
      mr.start();
      this.grabando.set(true);
    } catch {
      this.toast.error('No se pudo acceder al micrófono', 'Revisa los permisos del navegador.');
    }
  }

  // ── Subir un archivo de audio ──────────────────────────────
  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      this.toast.error('Archivo no válido', 'Selecciona un archivo de audio.');
      return;
    }
    await this.guardar(file);
  }

  private async guardar(blob: Blob, duracionSeg?: number) {
    if (this.busy() || !this.puedeAgregar()) return;
    this.busy.set(true);
    try {
      await this.service.add(this.entidadTipo(), this.entidadId(), this.bucket(), blob, {
        duracionSeg: duracionSeg ?? null,
        esPrueba: this.esPrueba(),
      });
      await this.load(this.entidadId());
      this.toast.success('Nota de voz agregada');
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar la nota de voz', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  async eliminar(n: AudioNota) {
    if (this.busy()) return;
    this.busy.set(true);
    const previous = this.notas();
    this.notas.update((list) => list.filter((x) => x.id !== n.id));
    try {
      await this.service.remove(n.id);
    } catch (e: unknown) {
      this.notas.set(previous);
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  duracionLabel(seg: number | null): string {
    if (seg == null || seg <= 0) return '';
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
