import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ReportesUsuarioService } from '../../../../shared/services/reportes-usuario.service';
import { UserService } from '../../../core/services/user.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import {
  ReporteUsuario,
  ReporteFoto,
  ReporteEstado,
  ReporteTipo,
  REPORTE_TIPO_LABELS,
  REPORTE_ESTADO_LABELS,
} from '../../../../shared/models/reporte-usuario.model';

@Component({
  selector: 'app-admin-reportes',
  imports: [ReactiveFormsModule, FormDrawer, DatePipe],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportes implements OnInit {
  private reportesService = inject(ReportesUsuarioService);
  private userService = inject(UserService);

  readonly TIPO_LABELS = REPORTE_TIPO_LABELS;
  readonly ESTADO_LABELS = REPORTE_ESTADO_LABELS;

  reportes = signal<ReporteUsuario[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  filterEstado = signal<'all' | ReporteEstado>('all');
  filterTipo = signal<'all' | ReporteTipo>('all');
  searchQuery = signal('');

  // ── Drawer ───────────────────────────────────────────────
  drawerOpen = signal(false);
  selected = signal<ReporteUsuario | null>(null);
  /** Resolved signed URLs for the selected report's photos, keyed by foto id. */
  fotoUrls = signal<Map<string, string>>(new Map());

  form = new FormGroup({
    estado: new FormControl<ReporteEstado>('abierto', { nonNullable: true, validators: [Validators.required] }),
    respuesta_admin: new FormControl(''),
  });

  currentUserId = computed(() => this.userService.profile()?.id ?? null);

  /** The reports this admin is actively working on right now — surfaced separately for visibility. */
  misEnProgreso = computed(() =>
    this.reportes().filter((r) => r.estado === 'en_progreso' && r.asignado_a === this.currentUserId()),
  );

  filtered = computed(() => {
    const estado = this.filterEstado();
    const tipo = this.filterTipo();
    const q = this.searchQuery().toLowerCase().trim();
    return this.reportes().filter((r) => {
      if (estado !== 'all' && r.estado !== estado) return false;
      if (tipo !== 'all' && r.tipo !== tipo) return false;
      if (q && !r.asunto.toLowerCase().includes(q) && !(r.usuario?.nombre ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  });

  drawerTitle = computed(() => {
    const r = this.selected();
    return r ? r.asunto : 'Reporte';
  });

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.reportes.set(await this.reportesService.getAll());
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar los reportes.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string) {
    this.searchQuery.set(value);
  }

  onFilterEstado(value: string) {
    this.filterEstado.set(value as 'all' | ReporteEstado);
  }

  onFilterTipo(value: string) {
    this.filterTipo.set(value as 'all' | ReporteTipo);
  }

  async tomar(r: ReporteUsuario) {
    const adminId = this.currentUserId();
    if (!adminId) return;
    this.reportes.update((list) =>
      list.map((x) => (x.id === r.id ? { ...x, estado: 'en_progreso', asignado_a: adminId } : x)),
    );
    try {
      await this.reportesService.tomar(r.id, adminId);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al tomar el reporte.');
      await this.load();
    }
  }

  openDetail(r: ReporteUsuario) {
    this.selected.set(r);
    this.saveError.set('');
    this.form.reset({ estado: r.estado, respuesta_admin: r.respuesta_admin ?? '' });
    this.fotoUrls.set(new Map());
    this.drawerOpen.set(true);
    void this.resolveFotoUrls(r.fotos ?? []);
  }

  private async resolveFotoUrls(fotos: ReporteFoto[]) {
    const entries = await Promise.all(
      fotos.map(async (f) => {
        try {
          return [f.id, await this.reportesService.getSignedUrl(f.storage_path)] as const;
        } catch {
          return [f.id, ''] as const;
        }
      }),
    );
    this.fotoUrls.set(new Map(entries));
  }

  getFotoUrl(f: ReporteFoto): string {
    return this.fotoUrls().get(f.id) ?? '';
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }

  async onSave() {
    if (this.saving()) return;
    const r = this.selected();
    if (!r) return;

    this.saving.set(true);
    this.saveError.set('');

    try {
      await this.reportesService.actualizarEstado(r.id, {
        estado: this.form.value.estado!,
        respuesta_admin: this.form.value.respuesta_admin?.trim() || null,
      });
      await this.load();
      this.drawerOpen.set(false);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
