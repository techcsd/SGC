import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IncentivosService, IncentivoFila, IncentivoSemanaRef, IncentivoDecision,
  IncentivoConfig, IncentivoFlag, RENGLON_LABELS, isoSemanaActual,
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
  // AU7 — vista comparativa (matriz choferes × categorías, el dibujo de Xaviel) vs. detalle.
  vista = signal<'matriz' | 'detalle'>('matriz');

  // Declinar
  declinandoId = signal<string | null>(null);
  motivoDeclina = signal('');

  // Config
  config = signal<IncentivoConfig | null>(null);
  mostrarConfig = signal(false);
  cfgMinimo = signal(10);
  cfgFactor = signal(1);
  cfgPesos = signal<Record<string, number>>({});
  // AX4 — penalización por estancamiento (renglón negativo). pts/día = 0 = apagada.
  cfgPenalGracia = signal(2);
  cfgPenalPts = signal(0);
  cfgPenalTope = signal(4);

  busy = signal(false);

  // AV7 — "Quién recibe este informe" (destinatarios por rol elevado).
  destinatarios = signal<{ email: string; nombre: string }[]>([]);
  mostrarDestinatarios = signal(false);

  semanaActual = computed(() =>
    this.semanas().find((s) => s.anio === this.selAnio() && s.semana === this.selSemana()) ?? null,
  );
  totalCumplieron = computed(() => this.filas().filter((f) => f.cumplio).length);
  pendientes = computed(() => this.filas().filter((f) => f.cumplio && f.decision !== 'aprobado').length);

  // BB8c — la semana ISO en curso (aún sin cerrar). Se ofrece en el selector en
  // modo avance/solo-lectura (no se aprueba hasta cerrar el corte).
  readonly semanaEnCurso = isoSemanaActual();
  /** Opciones del selector = semanas generadas + la semana en curso (si no está). */
  opcionesSemana = computed<(IncentivoSemanaRef & { enCurso?: boolean })[]>(() => {
    const gen = this.semanas();
    const yaEsta = gen.some((s) => s.anio === this.semanaEnCurso.anio && s.semana === this.semanaEnCurso.semana);
    if (yaEsta) return gen;
    return [
      { anio: this.semanaEnCurso.anio, semana: this.semanaEnCurso.semana, inicio: '', fin: '', choferes: 0, cumplieron: 0, enCurso: true },
      ...gen,
    ];
  });
  esSemanaEnCurso = computed(() =>
    this.selAnio() === this.semanaEnCurso.anio && this.selSemana() === this.semanaEnCurso.semana,
  );

  // BB8a — incidencias del chofer, AGRUPADAS por tipo y accionables. En cuarentena
  // (no puntúan) hasta que alguien las acepte/excluya.
  incidenciasDe(f: IncentivoFila): { tipo: string; label: string; items: IncentivoFlag[]; pendientes: number }[] {
    const flags = f.flags ?? [];
    const grupos = new Map<string, IncentivoFlag[]>();
    for (const fl of flags) {
      const k = fl.tipo || 'otro';
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(fl);
    }
    return [...grupos.entries()].map(([tipo, items]) => ({
      tipo,
      label: this.labelIncidencia(tipo),
      items,
      pendientes: items.filter((i) => (i.decision ?? 'cuarentena') === 'cuarentena').length,
    }));
  }
  private labelIncidencia(tipo: string): string {
    if (tipo === 'ruta_sin_metrica') return 'Rutas completadas con 0 km o 0 min';
    if (tipo === 'echada_duplicada') return 'Echadas en el mismo minuto que otra';
    return 'Incidencias';
  }

  /** BB8d — red de seguridad: limpia mojibake heredado ("â€"") al mostrar el texto. */
  limpiarTexto(s: string | null | undefined): string {
    if (!s) return '';
    return s
      .replace(/â€"/g, '—').replace(/â€“/g, '–')
      .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
      .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ');
  }

  /** BB8a — link al registro concreto de la incidencia (ruta/echada). */
  refIncidencia(fl: IncentivoFlag): { link: string[]; query?: Record<string, string> } {
    if (fl.ref_tipo === 'echada' || fl.tipo === 'echada_duplicada')
      return { link: ['/flota/combustible-log'], query: { echada: fl.ref_id } };
    return { link: ['/flota/rutas'], query: { ruta: fl.ref_id } };
  }

  /** BB8b — acepta una incidencia (pasa a puntuar) y recalcula. */
  async aceptarIncidencia(f: IncentivoFila, fl: IncentivoFlag) {
    await this.decidirIncidencia(fl, 'aceptada');
  }
  /** BB8b — excluye una incidencia (no puntúa, resuelta) y recalcula. */
  async excluirIncidencia(f: IncentivoFila, fl: IncentivoFlag) {
    await this.decidirIncidencia(fl, 'excluida');
  }
  private async decidirIncidencia(fl: IncentivoFlag, decision: 'aceptada' | 'excluida') {
    const anio = this.selAnio(), semana = this.selSemana();
    if (!anio || !semana || this.busy()) return;
    const refTipo: 'ruta' | 'echada' = fl.ref_tipo ?? (fl.tipo === 'echada_duplicada' ? 'echada' : 'ruta');
    this.busy.set(true);
    try {
      await this.service.decidirIncidencia(anio, semana, refTipo, fl.ref_id, decision);
      this.toast.success(decision === 'aceptada' ? 'Incidencia aceptada' : 'Incidencia excluida',
        decision === 'aceptada' ? 'Ahora cuenta para el puntaje.' : 'No cuenta para el puntaje.');
      await this.cargarFilas();
    } catch (e) {
      this.toast.error('No se pudo registrar la decisión', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  async ngOnInit() {
    try {
      const [semanas, cfg] = await Promise.all([this.service.semanas(), this.service.configActual()]);
      this.semanas.set(semanas);
      this.config.set(cfg);
      if (cfg) {
        this.cfgMinimo.set(cfg.minimo_semanal); this.cfgFactor.set(cfg.ayudante_factor); this.cfgPesos.set({ ...cfg.pesos });
        this.cfgPenalGracia.set(Number(cfg.pesos['_penal_gracia_dias'] ?? 2));
        this.cfgPenalPts.set(Number(cfg.pesos['_penal_pts_dia'] ?? 0));
        this.cfgPenalTope.set(Number(cfg.pesos['_penal_tope'] ?? 4));
      }

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
      // BB8c — la semana en curso se genera al vuelo (avance/solo-lectura): así el
      // chofer/Raykler ven cómo van HOY sin esperar el cierre del lunes.
      if (this.esSemanaEnCurso()) {
        try { await this.service.generar(anio, semana); } catch { /* si no puede generar, muestra lo que haya */ }
      }
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

  /** AU7 — puntos de una celda de la matriz (chofer × categoría). */
  puntosDe(f: IncentivoFila, renglon: string): number {
    return f.conteos?.[renglon]?.puntos ?? 0;
  }

  /** AU7 — desde la matriz, abrir el desglose del chofer (cada número es clickable). */
  async abrirDesglose(f: IncentivoFila) {
    this.vista.set('detalle');
    this.expandido.set(f.informe_id);
    if (!this.historial()[f.informe_id]) {
      try {
        const h = await this.service.historial(f.informe_id);
        this.historial.update((m) => ({ ...m, [f.informe_id]: h }));
      } catch { /* noop */ }
    }
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
    // BB9 — misma matriz detallada que el correo/PDF: una columna por renglón +
    // total + incidencias, además de la decisión (para nómina).
    exportarExcel(
      `incentivo-semana-${this.selAnio()}-${this.selSemana()}`,
      filas.map((f) => {
        const desglose: Record<string, string | number> = { Chofer: f.nombre };
        for (const r of this.renglones) {
          const c = this.conteoDe(f, r);
          desglose[RENGLON_LABELS[r]] = c ? c.propio + c.ayudante : 0;
        }
        desglose['Puntaje'] = f.puntaje;
        desglose['Mínimo'] = f.minimo;
        desglose['Incidencias'] = f.flags?.length ?? 0;
        desglose['Estado'] = f.cumplio ? 'Cumplió' : 'Rendimiento bajo';
        desglose['Decisión'] = f.decision ?? 'Pendiente';
        desglose['Motivo'] = f.motivo ?? '';
        desglose['Decidido por'] = f.decidido_por_nombre ?? '';
        desglose['Fecha'] = f.decidido_en ? this.formatFechaHora(f.decidido_en) : '';
        return desglose;
      }),
      'Incentivo',
    );
  }

  // ── AV7 — Destinatarios del informe ──
  async toggleDestinatarios() {
    const abrir = !this.mostrarDestinatarios();
    this.mostrarDestinatarios.set(abrir);
    if (abrir && this.destinatarios().length === 0) {
      try {
        this.destinatarios.set(await this.service.destinatariosInforme());
      } catch (e) {
        this.toast.error('No se pudo cargar la lista de destinatarios', e instanceof Error ? e.message : undefined);
      }
    }
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

  // AX4 — guarda la penalización por estancamiento (sobre la config activa).
  async guardarPenalizacion() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.service.setPenalizacion(this.cfgPenalGracia(), this.cfgPenalPts(), this.cfgPenalTope());
      this.config.set(await this.service.configActual());
      const estado = this.cfgPenalPts() > 0 ? 'activada' : 'apagada';
      this.toast.success(`Penalización ${estado}`, 'Aplica al recalcular la semana. Recalcula para verla reflejada.');
    } catch (e) {
      this.toast.error('No se pudo guardar la penalización', e instanceof Error ? e.message : undefined);
    } finally {
      this.busy.set(false);
    }
  }

  /** AX4 — etiqueta de un renglón (incluye el negativo 'estancamiento'). */
  labelRenglon(r: string): string {
    return this.RENGLON_LABELS[r] ?? (r === 'estancamiento' ? 'Penalización por estancamiento' : r);
  }
  /** AX4 — renglón de penalización de un chofer (si tiene). */
  penalDe(f: IncentivoFila) {
    return f.conteos?.['estancamiento'] ?? null;
  }
}
