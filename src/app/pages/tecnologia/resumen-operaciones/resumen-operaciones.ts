import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../../shared/services/toast.service';

/**
 * BE1 — Resumen semanal de operaciones (Tecnología): preview de la semana cerrada,
 * "Reenviar ahora" para probar sin esperar al lunes (patrón del incentivo), e
 * historial de envíos. Los números aquí = los del correo = los de cada módulo (AU1).
 */
interface Embudo {
  creadas: number; pendientes: number; aprobadas: number;
  despachadas_parcial: number; despachadas_total: number; canceladas: number;
}
interface Pendiente { codigo: string; obra: string; dias_esperando: number; fase: string }
interface Envio {
  anio: number; semana: number; ok: boolean; error: string | null;
  enviado_at: string; destinatarios: string[] | null;
}

@Component({
  selector: 'app-tec-resumen-operaciones',
  imports: [DatePipe],
  templateUrl: './resumen-operaciones.html',
  styleUrl: './resumen-operaciones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TecResumenOperaciones implements OnInit {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  loading = signal(true);
  error = signal('');
  reenviando = signal(false);

  anio = signal<number | null>(null);
  semana = signal<number | null>(null);
  rango = signal<{ inicio: string; fin: string } | null>(null);

  totalReqs = signal(0);
  matriz = signal<{ obra: string; ingeniero: string; cantidad: number }[]>([]);
  embudo = signal<Embudo | null>(null);
  pendientes = signal<Pendiente[]>([]);
  // Reportes 3-7 (payloads crudos de cada RPC; misma data del correo, AU1).
  rutas = signal<Record<string, unknown> | null>(null);
  conduces = signal<Record<string, unknown> | null>(null);
  inventario = signal<Record<string, unknown> | null>(null);
  flota = signal<Record<string, unknown> | null>(null);
  bitacoras = signal<Record<string, unknown> | null>(null);

  destinatarios = signal<{ email: string; nombre: string }[]>([]);
  historial = signal<Envio[]>([]);

  destinatariosTexto = computed(() =>
    this.destinatarios().map((d) => d.nombre || d.email).join(', '));

  // Accesores tipados de los payloads 3-7 (para el template).
  private n(o: Record<string, unknown> | null, k: string): number {
    return Number((o?.[k] as number) ?? 0);
  }
  rutasCompletadas = computed(() => this.n(this.rutas(), 'completadas'));
  rutasEnRevision = computed(() => this.n(this.rutas(), 'en_revision'));
  rutasPorChofer = computed(
    () => (this.rutas()?.['por_chofer'] as { chofer: string; completadas: number; en_revision: number }[]) ?? [],
  );
  conducesTotal = computed(() => this.n(this.conduces(), 'total'));
  conducesNormal = computed(() => this.n(this.conduces(), 'total_normal'));
  conducesExterno = computed(() => this.n(this.conduces(), 'total_externo'));
  conducesPorObra = computed(
    () => (this.conduces()?.['por_obra'] as { obra: string; normal: number; externo: number }[]) ?? [],
  );
  invEntradas = computed(() => this.n(this.inventario(), 'total_entradas'));
  invSalidas = computed(() => this.n(this.inventario(), 'total_salidas'));
  invAjustes = computed(() => this.n(this.inventario(), 'total_ajustes'));
  invPorAlmacen = computed(
    () => (this.inventario()?.['por_almacen'] as { almacen: string; entradas: number; salidas: number; ajustes: number }[]) ?? [],
  );
  flotaGalones = computed(() => this.n(this.flota(), 'total_galones'));
  flotaKm = computed(() => this.n(this.flota(), 'total_km'));
  flotaCosto = computed(() => this.n(this.flota(), 'total_costo'));
  flotaDepuracion = computed(() => !!this.flota()?.['km_en_depuracion']);
  flotaPorVehiculo = computed(
    () => (this.flota()?.['por_vehiculo'] as { placa: string; km: number; galones: number; costo: number }[]) ?? [],
  );
  bitacorasTotal = computed(() => this.n(this.bitacoras(), 'total_bitacoras'));
  bitacorasPorObra = computed(
    () => (this.bitacoras()?.['por_obra'] as { obra: string; dias_con_bitacora: number; dias_laborables: number }[]) ?? [],
  );

  fmtSemana = computed(() => {
    const a = this.anio(), s = this.semana(), r = this.rango();
    if (!a || !s) return '';
    return r ? `Semana ${s}/${a} · ${r.inicio} – ${r.fin}` : `Semana ${s}/${a}`;
  });

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const nil = { p_anio: null, p_semana: null };
      const [r1, r2, r3, r4, r5, r6, r7, dest, hist] = await Promise.all([
        this.supabase.client.rpc('resumen_requisiciones_semana', nil),
        this.supabase.client.rpc('resumen_estatus_requisiciones', nil),
        this.supabase.client.rpc('resumen_rutas_semana', nil),
        this.supabase.client.rpc('resumen_conduces_semana', nil),
        this.supabase.client.rpc('resumen_inventario_semana', nil),
        this.supabase.client.rpc('resumen_flota_carga_semana', nil),
        this.supabase.client.rpc('resumen_bitacoras_semana', nil),
        this.supabase.client.rpc('destinatarios_resumen_operaciones'),
        this.supabase.client
          .from('resumen_operaciones_envio')
          .select('*')
          .order('enviado_at', { ascending: false })
          .limit(12),
      ]);
      if (r1.error) throw r1.error;
      const d1 = r1.data as {
        anio: number; semana: number; inicio: string; fin: string; total: number;
        matriz: { obra: string; ingeniero: string; cantidad: number }[];
      };
      const d2 = r2.data as { embudo: Embudo; pendientes_por_atender: Pendiente[] };
      this.anio.set(d1.anio);
      this.semana.set(d1.semana);
      this.rango.set({ inicio: d1.inicio, fin: d1.fin });
      this.totalReqs.set(d1.total ?? 0);
      this.matriz.set(d1.matriz ?? []);
      this.embudo.set(d2?.embudo ?? null);
      this.pendientes.set(d2?.pendientes_por_atender ?? []);
      this.rutas.set((r3.data as Record<string, unknown>) ?? null);
      this.conduces.set((r4.data as Record<string, unknown>) ?? null);
      this.inventario.set((r5.data as Record<string, unknown>) ?? null);
      this.flota.set((r6.data as Record<string, unknown>) ?? null);
      this.bitacoras.set((r7.data as Record<string, unknown>) ?? null);
      this.destinatarios.set((dest.data as { email: string; nombre: string }[]) ?? []);
      this.historial.set((hist.data as Envio[]) ?? []);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el resumen.');
    } finally {
      this.loading.set(false);
    }
  }

  async reenviar() {
    const a = this.anio(), s = this.semana();
    if (!a || !s || this.reenviando()) return;
    if (!confirm(`¿Reenviar el resumen de la semana ${s}/${a} a ${this.destinatarios().length} destinatario(s) ahora?`)) return;
    this.reenviando.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('resumen_operaciones_enviar_semana', {
        p_anio: a, p_semana: s, p_forzar: true,
      });
      if (error) throw error;
      this.toast.success('Envío disparado', data === 'enviando' ? 'El correo saldrá en unos segundos.' : String(data));
      // Refresca el historial tras un momento.
      setTimeout(() => void this.load(), 4000);
    } catch (e) {
      this.toast.error('No se pudo reenviar', e instanceof Error ? e.message : undefined);
    } finally {
      this.reenviando.set(false);
    }
  }
}
