import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertasCuadreService } from '../../../../shared/services/alertas-cuadre.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Parametro } from '../../../../shared/models/cuadre.model';

/** Admin — umbrales configurables que disparan las alertas antifraude del cuadre. */
@Component({
  selector: 'app-admin-parametros',
  imports: [FormsModule],
  templateUrl: './parametros.html',
  styleUrl: './parametros.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminParametros implements OnInit {
  private service = inject(AlertasCuadreService);
  private toast = inject(ToastService);

  parametros = signal<Parametro[]>([]);
  loading = signal(true);
  error = signal('');

  /** Working copy of each valor, keyed by clave. */
  valores = signal<Record<string, string>>({});
  savingClave = signal<string | null>(null);

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const params = await this.service.getParametros();
      this.parametros.set(params);
      const map: Record<string, string> = {};
      for (const p of params) map[p.clave] = p.valor;
      this.valores.set(map);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los parámetros.');
    } finally {
      this.loading.set(false);
    }
  }

  setValor(clave: string, valor: string) {
    this.valores.update((m) => ({ ...m, [clave]: valor }));
  }

  isDirty(p: Parametro): boolean {
    return (this.valores()[p.clave] ?? p.valor) !== p.valor;
  }

  async guardar(p: Parametro) {
    if (this.savingClave()) return;
    const valor = (this.valores()[p.clave] ?? p.valor).trim();
    if (valor === p.valor) return;
    this.savingClave.set(p.clave);
    this.error.set('');
    try {
      await this.service.updateParametro(p.clave, valor);
      this.parametros.update((list) =>
        list.map((x) => (x.clave === p.clave ? { ...x, valor } : x)),
      );
      this.toast.success('Parámetro actualizado', p.clave);
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.savingClave.set(null);
    }
  }
}
