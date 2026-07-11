import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConteosService, Conteo } from '../../../../shared/services/conteos.service';

/** Conteo / ajuste history (physical counts from the field app + web). */
@Component({
  selector: 'app-inventario-conteos',
  imports: [DatePipe, FormsModule],
  templateUrl: './conteos.html',
  styleUrl: './conteos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Conteos implements OnInit {
  private service = inject(ConteosService);

  conteos = signal<Conteo[]>([]);
  loading = signal(true);
  error = signal('');
  search = signal('');
  expandedId = signal<string | null>(null);

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    if (!q) return this.conteos();
    return this.conteos().filter(
      (c) =>
        (c.bodega?.nombre ?? '').toLowerCase().includes(q) ||
        (c.creado?.nombre ?? '').toLowerCase().includes(q),
    );
  });

  async ngOnInit() {
    this.loading.set(true);
    try {
      this.conteos.set(await this.service.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  diff(antes: number, contada: number): string {
    const d = contada - antes;
    return d > 0 ? `+${d}` : `${d}`;
  }
}
