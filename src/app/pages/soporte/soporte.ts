import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportesUsuarioService } from '../../../shared/services/reportes-usuario.service';
import { UserService } from '../../core/services/user.service';
import { ReporteUsuario, REPORTE_TIPO_LABELS, REPORTE_ESTADO_LABELS, ReporteTipo } from '../../../shared/models/reporte-usuario.model';
import { DonutChart, DonutDatum } from '../../../shared/ui/donut-chart/donut-chart';
import { BarChart, BarDatum } from '../../../shared/ui/bar-chart/bar-chart';

@Component({
  selector: 'app-soporte',
  imports: [ReactiveFormsModule, DatePipe, RouterLink, DonutChart, BarChart],
  templateUrl: './soporte.html',
  styleUrl: './soporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Soporte implements OnInit {
  private reportesService = inject(ReportesUsuarioService);
  private userService = inject(UserService);

  readonly TIPO_LABELS = REPORTE_TIPO_LABELS;
  readonly ESTADO_LABELS = REPORTE_ESTADO_LABELS;
  readonly TIPOS: ReporteTipo[] = ['comentario', 'bug', 'sugerencia'];

  reportes = signal<ReporteUsuario[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveError = signal('');
  sent = signal(false);

  // ── Dashboard ────────────────────────────────────────────
  total = computed(() => this.reportes().length);
  resueltos = computed(() => this.reportes().filter((r) => r.estado === 'resuelto').length);

  porEstado = computed<DonutDatum[]>(() => {
    const colors: Record<string, string> = {
      abierto: '#64748b', en_progreso: '#1F4E79', resuelto: '#2D7D46', descartado: '#C0392B',
    };
    return (['abierto', 'en_progreso', 'resuelto', 'descartado'] as const)
      .map((e) => ({ label: this.ESTADO_LABELS[e], value: this.reportes().filter((r) => r.estado === e).length, color: colors[e] }))
      .filter((d) => d.value > 0);
  });

  porTipo = computed<BarDatum[]>(() => {
    const colors: Record<string, string> = { comentario: 'var(--sgc-primary)', bug: 'var(--sgc-danger)', sugerencia: 'var(--sgc-warning)' };
    return this.TIPOS.map((t) => ({ label: this.TIPO_LABELS[t], value: this.reportes().filter((r) => r.tipo === t).length, color: colors[t] })).filter(
      (d) => d.value > 0,
    );
  });

  form = new FormGroup({
    tipo: new FormControl<ReporteTipo>('comentario', { nonNullable: true, validators: [Validators.required] }),
    asunto: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    descripcion: new FormControl('', [Validators.required, Validators.maxLength(2000)]),
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.reportes.set(await this.reportesService.getMisReportes());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar tus reportes.');
    } finally {
      this.loading.set(false);
    }
  }

  async onSave() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    const usuarioId = this.userService.profile()?.id;
    if (!usuarioId) return;

    this.saving.set(true);
    this.saveError.set('');
    this.sent.set(false);

    try {
      const created = await this.reportesService.crear({
        usuario_id: usuarioId,
        tipo: this.form.value.tipo!,
        asunto: this.form.value.asunto!.trim(),
        descripcion: this.form.value.descripcion!.trim(),
      });
      this.reportes.update((list) => [created, ...list]);
      this.form.reset({ tipo: 'comentario', asunto: '', descripcion: '' });
      this.sent.set(true);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al enviar tu reporte.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
