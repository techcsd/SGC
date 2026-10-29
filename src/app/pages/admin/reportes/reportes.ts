import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ReportesUsuarioService } from '../../../../shared/services/reportes-usuario.service';
import { UserService } from '../../../core/services/user.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { LightboxService } from '../../../../shared/ui/lightbox/lightbox.service';
import {
  ReporteUsuario,
  ReporteFoto,
  ReporteEstado,
  ReporteTipo,
  ReporteIaResumen,
  REPORTE_TIPO_LABELS,
  REPORTE_ESTADO_LABELS,
} from '../../../../shared/models/reporte-usuario.model';
import { NotasService } from '../../../../shared/services/notas.service';
import { formatFechaMedia, formatFechaHumana } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Paginator } from '../../../../shared/ui/paginator/paginator';

@Component({
  selector: 'app-admin-reportes',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, Paginator],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportes implements OnInit {
  private reportesService = inject(ReportesUsuarioService);
  private userService = inject(UserService);
  private lightbox = inject(LightboxService);

  readonly TIPO_LABELS = REPORTE_TIPO_LABELS;
  readonly ESTADO_LABELS = REPORTE_ESTADO_LABELS;

  formatFecha = formatFechaMedia; // U9
  formatFechaHora = formatFechaHumana; // U9

  reportes = signal<ReporteUsuario[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  saveError = signal('');

  // ── Filters ──────────────────────────────────────────────
  filterEstado = signal<'all' | ReporteEstado>('all');
  filterTipo = signal<'all' | ReporteTipo>('all');
  searchQuery = signal('');

  // ── Pagination ───────────────────────────────────────────
  page = signal(1);
  readonly PAGE_SIZE = 20;

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

  paginated = computed(() => {
    const start = (this.page() - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
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
    this.page.set(1);
  }

  onFilterEstado(value: string) {
    this.filterEstado.set(value as 'all' | ReporteEstado);
    this.page.set(1);
  }

  onFilterTipo(value: string) {
    this.filterTipo.set(value as 'all' | ReporteTipo);
    this.page.set(1);
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

  // CX4 — toda la fila/tarjeta abre el detalle; accesible por teclado (Enter/Espacio).
  onRowKeydown(e: KeyboardEvent, r: ReporteUsuario) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openDetail(r);
    }
  }

  openDetail(r: ReporteUsuario) {
    this.selected.set(r);
    this.saveError.set('');
    this.form.reset({ estado: r.estado, respuesta_admin: r.respuesta_admin ?? '' });
    this.fotoUrls.set(new Map());
    this.iaResumen.set(r.ia_resumen ?? null);
    this.iaError.set('');
    this.drawerOpen.set(true);
    void this.resolveFotoUrls(r.fotos ?? []);
  }

  // ── DB6 — «Resumir para ronda» (IA) ──────────────────────────────────────────
  iaResumen = signal<ReporteIaResumen | null>(null);
  resumiendo = signal(false);
  iaError = signal('');
  guardandoNota = signal(false);
  private notasSvc = inject(NotasService);

  async resumir(forzar = false) {
    const r = this.selected();
    if (!r || this.resumiendo()) return;
    this.resumiendo.set(true);
    this.iaError.set('');
    try {
      const { resumen } = await this.reportesService.resumir(r.id, forzar);
      this.iaResumen.set(resumen);
      this.reportes.update((list) => list.map((x) => (x.id === r.id ? { ...x, ia_resumen: resumen } : x)));
    } catch (e: unknown) {
      this.iaError.set(e instanceof Error ? e.message : 'No se pudo resumir el reporte.');
    } finally {
      this.resumiendo.set(false);
    }
  }

  async copiar(texto: string | null, que: string) {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      this.saveError.set('');
      this.iaError.set(`✓ ${que} copiado al portapapeles.`);
      setTimeout(() => { if (this.iaError().startsWith('✓')) this.iaError.set(''); }, 2500);
    } catch {
      this.iaError.set('El navegador bloqueó el portapapeles.');
    }
  }

  /** DB6 — agrega el resumen a la nota «Ronda próxima — <mes>» de Dev notes
   *  (grupo «Ronda próxima»), con el link al reporte al final. */
  async guardarEnDevNotes() {
    const r = this.selected();
    const resumen = this.iaResumen();
    const miId = this.currentUserId();
    if (!r || !resumen || !miId || this.guardandoNota()) return;
    this.guardandoNota.set(true);
    try {
      const mes = new Date().toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
      const titulo = `Ronda próxima — ${mes}`;
      const notas = await this.notasSvc.getMisNotas(miId, false, 'dev');
      const existente = notas.find((n) => (n.titulo ?? '').trim() === titulo);
      const bloque = [
        `## Reporte #${r.id.slice(0, 8)} — ${r.asunto}`,
        resumen.resumen_ronda,
        resumen.es_hotfix ? `**Parece hotfix:** ${resumen.motivo}` : '',
        `[Abrir en Administración › Reportes](/admin/reportes)`,
      ].filter(Boolean).join('\n\n');
      const contenido = existente?.contenido ? `${existente.contenido}\n\n---\n\n${bloque}` : bloque;
      const notaId = existente?.id ?? crypto.randomUUID();
      await this.notasSvc.guardarNota({
        id: notaId, titulo, contenido,
        color: existente?.color ?? null,
        pinned: existente?.pinned ?? false,
        archivada: false,
        ambito: 'dev',
        formato: 'markdown',
      });
      // Grupo «Ronda próxima» (se crea una vez; mover es idempotente).
      try {
        const grupos = await this.notasSvc.getGrupos();
        let grupo = grupos.find((g) => g.nombre === 'Ronda próxima');
        if (!grupo) grupo = await this.notasSvc.crearGrupo('Ronda próxima', null, miId);
        await this.notasSvc.moverNotaAGrupo(notaId, grupo.id);
      } catch { /* la nota ya quedó guardada; el grupo es cosmético */ }
      this.iaError.set(`✓ Guardado en Dev notes › «${titulo}».`);
      setTimeout(() => { if (this.iaError().startsWith('✓')) this.iaError.set(''); }, 3500);
    } catch (e: unknown) {
      this.iaError.set(e instanceof Error ? e.message : 'No se pudo guardar en Dev notes.');
    } finally {
      this.guardandoNota.set(false);
    }
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

  // CX5 — abre el visor de pantalla completa compartido (shared/ui/lightbox) en vez
  // de la pestaña nueva de antes; con flechas/contador si el reporte trae varias.
  verFoto(index: number) {
    const r = this.selected();
    if (!r) return;
    const urls = (r.fotos ?? []).map((f) => this.getFotoUrl(f)).filter(Boolean);
    if (!urls.length) return;
    this.lightbox.abrirGaleria(urls, index, r.asunto);
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
