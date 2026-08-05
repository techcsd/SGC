import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ModuloOrdenService, NAV_SECCIONES } from '../../../../shared/services/modulo-orden.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * AF38 — Orden de los módulos/secciones del menú lateral. El admin reordena con
 * las flechas y guarda; el shell aplica el orden (las secciones sin configurar
 * conservan su posición por defecto). "Administración" queda siempre al final.
 */
@Component({
  selector: 'app-admin-orden-modulos',
  imports: [Skeleton],
  templateUrl: './orden-modulos.html',
  styleUrl: './orden-modulos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrdenModulos implements OnInit {
  private svc = inject(ModuloOrdenService);
  private toast = inject(ToastService);

  secciones = signal<string[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  async ngOnInit() {
    try {
      const map = await this.svc.getOrdenMap();
      // Ordena por el valor guardado; cualquier sección nueva/sin config va al final
      // en su orden por defecto.
      const orden = [...NAV_SECCIONES].sort((a, b) => {
        const oa = map[a] ?? (1000 + NAV_SECCIONES.indexOf(a));
        const ob = map[b] ?? (1000 + NAV_SECCIONES.indexOf(b));
        return oa - ob;
      });
      this.secciones.set(orden);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el orden.');
      this.secciones.set([...NAV_SECCIONES]);
    } finally {
      this.loading.set(false);
    }
  }

  subir(i: number) {
    if (i <= 0) return;
    this.secciones.update((s) => {
      const n = [...s];
      [n[i - 1], n[i]] = [n[i], n[i - 1]];
      return n;
    });
  }
  bajar(i: number) {
    this.secciones.update((s) => {
      if (i >= s.length - 1) return s;
      const n = [...s];
      [n[i + 1], n[i]] = [n[i], n[i + 1]];
      return n;
    });
  }

  async guardar() {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.svc.guardar(this.secciones().map((clave, orden) => ({ clave, etiqueta: clave, orden })));
      this.toast.success('Orden guardado', 'El menú se reordenará al recargar la página.');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo guardar el orden.');
    } finally {
      this.saving.set(false);
    }
  }

  restablecer() {
    this.secciones.set([...NAV_SECCIONES]);
  }
}
