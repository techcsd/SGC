import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertasCuadreService } from '../../../../shared/services/alertas-cuadre.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Parametro } from '../../../../shared/models/cuadre.model';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import {
  PARAM_GRUPOS,
  ParamFuente,
  ParamMeta,
  metaDe,
  validarValor,
} from '../../../../shared/config/parametros-catalogo';

/** Fila de configuración con su metadato resuelto y la tabla de origen. */
interface ConfigRow {
  clave: string;
  valor: string;
  fuente: ParamFuente; // tabla real de origen (parametros | flota)
  meta: ParamMeta;
}

interface ConfigGrupo {
  grupo: string;
  filas: ConfigRow[];
}

/**
 * Admin — Configuración del sistema (BK5). Superficie ÚNICA sobre las DOS tablas
 * clave/valor: `sgc.parametros` (UPDATE directo) y `sgc.flota_config` (RPC
 * set_flota_config). Antes las claves de flota no se veían aquí. Agrupadas por
 * área, con el input y la validación correctos por clave (ver catálogo).
 */
@Component({
  selector: 'app-admin-parametros',
  imports: [FormsModule, Skeleton],
  templateUrl: './parametros.html',
  styleUrl: './parametros.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminParametros implements OnInit {
  private service = inject(AlertasCuadreService);
  private toast = inject(ToastService);

  private rows = signal<ConfigRow[]>([]);
  loading = signal(true);
  error = signal('');

  /** Working copy of each valor, keyed by clave. */
  valores = signal<Record<string, string | undefined>>({});
  savingClave = signal<string | null>(null);

  total = computed(() => this.rows().length);

  /** Filas agrupadas y ordenadas por PARAM_GRUPOS; grupos desconocidos al final. */
  grupos = computed<ConfigGrupo[]>(() => {
    const byGrupo = new Map<string, ConfigRow[]>();
    for (const r of this.rows()) {
      const g = r.meta.grupo || 'Otros';
      (byGrupo.get(g) ?? byGrupo.set(g, []).get(g)!).push(r);
    }
    const orden = [...PARAM_GRUPOS];
    const salida: ConfigGrupo[] = [];
    for (const g of orden) {
      const filas = byGrupo.get(g);
      if (filas?.length) salida.push({ grupo: g, filas: filas.sort((a, b) => a.clave.localeCompare(b.clave)) });
      byGrupo.delete(g);
    }
    for (const [g, filas] of byGrupo) salida.push({ grupo: g, filas: filas.sort((a, b) => a.clave.localeCompare(b.clave)) });
    return salida;
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [params, flota] = await Promise.all([
        this.service.getParametros(),
        this.service.getFlotaConfig(),
      ]);
      const rows: ConfigRow[] = [];
      const map: Record<string, string> = {};
      for (const p of params) {
        rows.push({ clave: p.clave, valor: p.valor, fuente: 'parametros', meta: metaDe(p.clave, 'parametros') });
        map[p.clave] = p.valor;
      }
      for (const f of flota) {
        // Si por alguna razón una clave existe en ambas tablas, gana parametros
        // (no la duplicamos). No debería pasar tras BK5.
        if (map[f.clave] != null) continue;
        rows.push({ clave: f.clave, valor: f.valor, fuente: 'flota', meta: metaDe(f.clave, 'flota') });
        map[f.clave] = f.valor;
      }
      this.rows.set(rows);
      this.valores.set(map);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la configuración.');
    } finally {
      this.loading.set(false);
    }
  }

  setValor(clave: string, valor: string) {
    this.valores.update((m) => ({ ...m, [clave]: valor }));
  }

  isDirty(r: ConfigRow): boolean {
    return (this.valores()[r.clave] ?? r.valor) !== r.valor;
  }

  /** Error de validación en vivo (null si válido). */
  errorDe(r: ConfigRow): string | null {
    return validarValor(r.meta, this.valores()[r.clave] ?? r.valor);
  }

  async guardar(r: ConfigRow) {
    if (this.savingClave()) return;
    const valor = (this.valores()[r.clave] ?? r.valor).trim();
    if (valor === r.valor) return;
    const err = validarValor(r.meta, valor);
    if (err) {
      this.toast.error('Valor inválido', `${r.clave}: ${err}`);
      return;
    }
    this.savingClave.set(r.clave);
    this.error.set('');
    try {
      if (r.fuente === 'flota') {
        await this.service.setFlotaConfig(r.clave, Number(valor));
      } else {
        await this.service.updateParametro(r.clave, valor);
      }
      this.rows.update((list) => list.map((x) => (x.clave === r.clave ? { ...x, valor } : x)));
      this.toast.success('Parámetro actualizado', r.clave);
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.savingClave.set(null);
    }
  }
}
