import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';

/**
 * R6 — Zona de subida de archivos consistente (design system).
 * Presentacional/controlado: el padre mantiene la lista (`files`) y reacciona a
 * `add`/`removeAt`. Soporta arrastrar-soltar o tocar, contador n/max y
 * miniaturas de imágenes (con quitar). Reemplaza el `<input type="file">` nativo.
 */
@Component({
  selector: 'app-file-upload',
  imports: [],
  templateUrl: './file-upload.html',
  styleUrl: './file-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUpload {
  files = input<File[]>([]);
  max = input<number>(40);
  accept = input<string>('image/*');
  label = input<string>('Arrastra o toca para subir');
  hint = input<string>('');

  add = output<File[]>();
  removeAt = output<number>();

  dragging = signal(false);
  private previews = signal<Map<File, string>>(new Map());

  lleno = computed(() => this.files().length >= this.max());

  onSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.emit(Array.from(input.files ?? []));
    input.value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    if (this.lleno()) return;
    this.emit(Array.from(event.dataTransfer?.files ?? []));
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    if (!this.lleno()) this.dragging.set(true);
  }
  onDragLeave() {
    this.dragging.set(false);
  }

  private emit(selected: File[]) {
    if (selected.length === 0) return;
    const libre = Math.max(0, this.max() - this.files().length);
    this.add.emit(selected.slice(0, libre));
  }

  quitar(i: number) {
    this.removeAt.emit(i);
  }

  esImagen(f: File): boolean {
    return f.type.startsWith('image/');
  }

  /** Object URL para la miniatura (memoizado por File para no recrearlo). */
  previewUrl(f: File): string | null {
    if (!this.esImagen(f)) return null;
    const map = this.previews();
    let url = map.get(f);
    if (!url) {
      url = URL.createObjectURL(f);
      map.set(f, url);
    }
    return url;
  }
}
