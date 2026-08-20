import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IncentivosService, IncentivoFila, IncentivoSemanaRef, IncentivoDecision,
  IncentivoConfig, RENGLON_LABELS,
} from '../../../shared/services/incentivos.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { formatFechaDisplay, formatFechaHoraDisplay } from '../../../shared/utils/fecha.util';
import { exportarExcel } from '../../../shared/utils/exportar-excel.util';

@Component({
  selector: 'app-incentivos',
  imports: [FormsModule, RouterLink, Skeleton],
  templateUrl: './incentivos.html',
  styleUrl: './incentivos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Incentivos implements OnInit {
  private service = inject(IncentivosService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  readonly RENGLON_LABELS = RENGLON_LABELS;
  readonly renglones = Object.keys(RENGLON_LABELS);
  readonly formatFecha = formatFechaDisplay;
  readonly formatFechaHora = formatFechaHoraDisplay;

  semanas = signal<IncentivoSemanaRef[]>([]);
  filas = signal<IncentivoFila[]>([]);
  loading = signal(true);
  loadingFilas = signal(false);
  error = signal('');
  selAnio = signal<number | null>(null);
  selSemana = signal<number | null>(null);
  expandido = signal<string | null>(null);
  historial = signal<Record<string, IncentivoDecision[]>>({});

  // Declinar
  declinandoId = signal<string | null>(null);
  motivoDeclina = signal('');

  // Config
  config = signal<IncentivoConfig | null>(null);
  mostrarConfig = signal(false);
  cfgMinimo = signal(10);
  cfgFactor = signal(1);
  cfgPesos = signal<Record<string, number>>({});

  busy = signal(false);

  semanaActual = computed(() =>
    this.semanas().find((s) => s.anio === this.selAnio() && s.semana === this.selSemana()) ?? null,
  );
  totalCumplieron = computed(() => this.filas().filter((f) => f.cumplio).length);
  pendientes = computed(() => this.filas().filter((f) => f.cumplio && f.decision !== 'aprobado').length);

  async ngOnInit() {
    try {
      const [semanas, cfg] = await Promise.all([this.service.semanas(), this.service.configActual()]);
      this.semanas.set(semanas);
      this.config.set(cfg);
      if (cfg) { this.cfgMinimo.set(cfg.minimo_semanal); this.cfgFactor.set(cfg.ayudante_factor); this.cfgPesos.set({ ...cfg.pesos }); }

      // Deep-link desde el email: /incentivos?anio=&semana=
      const qa = Number(this.route.snapshot.queryParamMap.get('anio'));
      const qs = Number(this.route.snapshot.queryParamMap.get('semana'));
      const target = (qa && qs) ? { anio: qa, semana: qs } : (semanas[0] ?? null);
      if (target) { this.selAnio.set(target.anio); this.selSemana.set(target.semana); await this.cargarFilas(); }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  async onSemanaChange(value: string) {
    const [anio, semana] = value.split('-').map(Number);
    this.selAnio.set(anio); this.selSemana.set(semana);
    this.expandido.set(null);
    await this.cargarFilas();
  }

  private async cargarFilas() {
    const anio = this.selAnio(), semana = this.selSemana();
    if (!anio || !semana) return;
    this.loadingFilas.set(true);
    try {
      this.filas.set(await this.service.listado(anio, semana));
    } catch (e) {
      this.toast.error('No se pudo cargar la semana', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingFilas.set(false);
    }
  }

  async toggleDetalle(f: IncentivoFila) {
    if (this.expandido() === f.informe_id) { this.expandido.set(null); return; }
    this.expandido.set(f.informe_id);
    if (!this.historial()[f.informe_id]) {
      try {
        const h = await this.service.historial(f.informe_id);
        this.historial.update((m) => ({ ...m, [f.informe_id]: h }));
      } catch { /* noop */ }
    }
  }

  conteoDe(f: IncentivoFila, renglon: string) {
    return f.conteos?.[renglon] ?? null;
  }

  /** Ruta clickable para un registro que compone el puntaje (trazabilidad AT1.e). */
  refRuta(tipo: string, id: string): string[] {
    switch (tipo) {
      case 'conduce': return ['/inventario/salidas', id, 'conduce'];
      case 'echada': return ['/flota/combustible-log'];
      case 'ruta': return ['/flota/rutas'];
      default: return ['/flota/checklists'];
    }
  }

  async aprobar(f: IncentivoFila) {
    await this.decidir(f, 'aprobado', null);
  }

  abrirDeclinar(f: IncentivoFila) {
    this.declinandoId.set(f.informe_id);
    this.motivoDeclina.set('');
  }

  async confirmarDeclinar(f: IncentivoFila) {
    const motivo = this.motivoDeclina().trim();
    if (!motivo) { this.toast.warning('Motivo requerido', 'Al declinar debes indicar el motivo.'); return; }
    await this.decidir(f, 'declinado', motivo);
    this.declinandoId.set(null);
  }

  private async decidir(f: IncentivoFila, decision: 'aprobado' | 'declinado', motivo: string | null) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.service.decidir(f.informe_id, decision, motivo);
      this.toast.success(decision === 'aprobado' ? 'Incentivo aprobado' : 'Incentivo declinado', `${f.nombre} — semana ${this.selSemana()}`);
      await this.cargarFilas();
      this.historial.update((m) => { const c = { ...m }; delete c[f.informe_id]; return c; });
    } catch (e) {
      this.toast.error('No se pudo registrar la decisión', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  async aprobarTodos() {
    const anio = this.selAnio(), semana = this.selSemana();
    if (!anio || !semana || this.busy()) return;
    if (!confirm(`¿Aprobar el incentivo de los ${this.pendientes()} choferes que cumplieron y siguen pendientes?`)) return;
    this.busy.set(true);
    try {
      const n = await this.service.aprobarCumplieron(anio, semana);
      this.toast.success('Aprobación masiva', `Se aprobaron ${n} incentivos.`);
      await this.cargarFilas();
    } catch (e) {
      this.toast.error('No se pudo aprobar en lote', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  async regenerar() {
    const anio = this.selAnio(), semana = this.selSemana();
    if (!anio || !semana || this.busy()) return;
    this.busy.set(true);
    try {
      await this.service.generar(anio, semana);
      await this.cargarFilas();
      this.toast.success('Informe recalculado', `Semana ${semana}/${anio}.`);
    } catch (e) {
      this.toast.error('No se pudo recalcular', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  async reenviar() {
    const anio = this.selAnio(), semana = this.selSemana();
    if (!anio || !semana || this.busy()) return;
    this.busy.set(true);
    try {
      const r = await this.service.enviar(anio, semana, true);
      this.toast.success('Correo del incentivo', r === 'ya_enviado' ? 'Ya se había enviado.' : 'Reenviando el informe por correo…');
    } catch (e) {
      this.toast.error('No se pudo reenviar', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  exportar() {
    const filas = this.filas();
    if (!filas.length) return;
    exportarExcel(
      `incentivo-semana-${this.selAnio()}-${this.selSemana()}`,
      filas.map((f) => ({
        Chofer: f.nombre,
        Puntaje: f.puntaje,
        Mínimo: f.minimo,
        Estado: f.cumplio ? 'Cumplió' : 'Rendimiento bajo',
        Decisión: f.decision ?? 'Pendiente',
        Motivo: f.motivo ?? '',
        'Decidido por': f.decidido_por_nombre ?? '',
        Fecha: f.decidido_en ? this.formatFechaHora(f.decidido_en) : '',
      })),
      'Incentivo',
    );
  }

  // ── Config ──
  toggleConfig() { this.mostrarConfig.update((v) => !v); }
  setPeso(renglon: string, value: string) {
    this.cfgPesos.update((p) => ({ ...p, [renglon]: Number(value) }));
  }
  async guardarConfig() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.service.setConfig(this.cfgMinimo(), this.cfgPesos(), this.cfgFactor(), 'Editado desde Incentivos');
      this.config.set(await this.service.configActual());
      this.toast.success('Configuración guardada', 'Los informes futuros usarán estos pesos; los anteriores conservan los suyos.');
      this.mostrarConfig.set(false);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }
}
