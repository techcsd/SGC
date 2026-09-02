import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

/**
 * BG2 — "Outbox atascado": registros que la app móvil no pudo enviar por errores
 * de SISTEMA (RLS/constraint/5xx) — data real de obra que se quedó en el teléfono.
 * Antes Xaviel se enteraba por un screenshot de un ingeniero DOS SEMANAS después;
 * ahora Tecnología recibe alerta + ve aquí el conteo y el detalle (tipo, usuario,
 * error, edad, intentos, fotos en riesgo). Gate: es_tecnologia.
 */
interface OutboxItem {
  id: string;
  tipo_op: string;
  categoria: 'sistema' | 'dato' | 'transitorio';
  error_kind: string | null;
  error_code: string | null;
  error_msg: string | null;
  intentos: number;
  fotos_count: number;
  edad_horas: number | null;
  payload_resumen: Record<string, unknown> | null;
  usuario_nombre: string | null;
  roles_snapshot: string | null;
  primera_vez: string;
  ultima_vez: string;
  resuelto: boolean;
}
interface Conteos {
  total: number;
  pendientes: number;
  sistema: number;
  dato: number;
  transitorio: number;
  usuarios_afectados: number;
  fotos_en_riesgo: number;
  mas_viejo_horas: number;
  ultimos_7d: number;
}

const TIPO_LABEL: Record<string, string> = {
  bitacora: 'Bitácora',
  echada: 'Echada de combustible',
  confirmacion: 'Confirmación',
  conduce: 'Conduce',
  conduce_externo: 'Conduce externo',
  ficha_personal: 'Ficha de personal',
};

@Component({
  selector: 'app-tec-outbox-atascados',
  imports: [DatePipe],
  templateUrl: './outbox-atascados.html',
  styleUrl: './outbox-atascados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecOutboxAtascados implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  filas = signal<OutboxItem[]>([]);
  conteos = signal<Conteos | null>(null);
  loading = signal(true);
  error = signal('');

  filtroCategoria = signal<'todas' | 'sistema' | 'dato' | 'transitorio'>('todas');
  soloPendientes = signal(true);

  filasVisibles = computed(() => {
    const c = this.filtroCategoria();
    const p = this.soloPendientes();
    return this.filas().filter(
      (f) => (c === 'todas' || f.categoria === c) && (!p || !f.resuelto),
    );
  });

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t.replace(/_/g, ' ');
  }
  categoriaLabel(c: string): string {
    return c === 'sistema'
      ? 'Error del sistema'
      : c === 'dato'
        ? 'Error de dato'
        : c === 'transitorio'
          ? 'Transitorio'
          : c;
  }
  resumenTexto(r: Record<string, unknown> | null): string {
    if (!r) return '';
    return Object.entries(r)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [{ data: conteos }, { data: filas, error: e2 }] = await Promise.all([
        this.supabase.client.rpc('outbox_atascados_conteos'),
        this.supabase.client.rpc('outbox_atascados_listado', {
          p_categoria: null,
          p_solo_pendientes: false,
          p_limite: 500,
        }),
      ]);
      if (e2) throw e2;
      this.conteos.set((conteos as Conteos) ?? null);
      this.filas.set((filas as OutboxItem[]) ?? []);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  setCategoria(c: 'todas' | 'sistema' | 'dato' | 'transitorio') {
    this.filtroCategoria.set(c);
  }
  togglePendientes() {
    this.soloPendientes.update((v) => !v);
  }

  async resolver(f: OutboxItem, resuelto: boolean) {
    try {
      const { error } = await this.supabase.client.rpc('outbox_atascado_resolver', {
        p_id: f.id,
        p_resuelto: resuelto,
        p_nota: null,
      });
      if (error) throw error;
      this.filas.update((fs) => fs.map((x) => (x.id === f.id ? { ...x, resuelto } : x)));
      this.toast.success(resuelto ? 'Marcado como resuelto' : 'Reabierto');
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }
}
