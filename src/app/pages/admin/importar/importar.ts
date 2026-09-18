import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import * as XLSX from 'xlsx';
import { ImportadorService, ENTIDADES, EntidadImportable, ResultadoImport } from '../../../../shared/services/importador.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';

/** BT1 (#47) — "Importar datos": asistente Excel/CSV → entidad con mapeo de columnas
 *  (auto-match incluido Odoo), preview, importación fila a fila y deshacer 24 h. */
@Component({
  selector: 'app-admin-importar',
  imports: [DatePipe],
  templateUrl: './importar.html',
  styleUrl: './importar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminImportar implements OnInit {
  private svc = inject(ImportadorService);
  private toast = inject(ToastService);

  entidades = ENTIDADES;
  paso = signal<1 | 2 | 3 | 4>(1);
  entidad = signal<EntidadImportable | null>(null);
  headers = signal<string[]>([]);
  rows = signal<Record<string, unknown>[]>([]);
  mapeo = signal<Record<string, string>>({});
  nombreArchivo = signal('');
  procesando = signal(false);
  resultado = signal<ResultadoImport | null>(null);
  historial = signal<{ id: string; entidad: string; nuevos: number; actualizados: number; errores: unknown[]; deshecha_at: string | null; created_at: string }[]>([]);

  /** Preview: primeras 8 filas crudas (se leen por columna mapeada con colValor). */
  preview = computed(() => this.rows().slice(0, 8));
  camposRequeridosFaltan = computed(() => {
    const e = this.entidad(); if (!e) return [];
    const m = this.mapeo();
    return e.campos.filter((c) => c.requerido && !m[c.t]).map((c) => c.label);
  });

  async ngOnInit() { await this.cargarHistorial(); }
  private async cargarHistorial() {
    try { this.historial.set(await this.svc.historial()); } catch { /* best-effort */ }
  }

  async elegirEntidad(e: EntidadImportable) {
    this.entidad.set(e);
    this.paso.set(2);
    // Precarga el mapeo recordado por entidad.
    try { this.mapeo.set(await this.svc.mapeoRecordado(e.key)); } catch { /* nuevo */ }
  }

  async onArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.nombreArchivo.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!rows.length) { this.toast.warning('El archivo no tiene filas'); return; }
      this.rows.set(rows);
      this.headers.set(Object.keys(rows[0]));
      const e = this.entidad()!;
      // Auto-mapeo (combina lo recordado con el auto-match del archivo).
      this.mapeo.set({ ...this.svc.autoMapeo(e, this.headers()), ...this.mapeo() });
      this.paso.set(3);
    } catch (e) {
      this.toast.error('No se pudo leer el archivo', e instanceof Error ? e.message : undefined);
    } finally {
      input.value = '';
    }
  }

  setMapeo(campo: string, col: string) {
    this.mapeo.update((m) => ({ ...m, [campo]: col }));
  }

  irAPreview() {
    if (this.camposRequeridosFaltan().length) {
      this.toast.warning('Faltan columnas', 'Mapea: ' + this.camposRequeridosFaltan().join(', '));
      return;
    }
    this.paso.set(4);
  }

  async importar() {
    const e = this.entidad();
    if (!e || this.procesando()) return;
    this.procesando.set(true);
    try {
      const filas = this.svc.aplicarMapeo(this.rows(), this.mapeo());
      const id = await this.svc.crearImportacion(e.key, filas.length);
      const r = await this.svc.importar(e, filas, id);
      await this.svc.registrarResultado(id, r);
      await this.svc.guardarMapeo(e.key, this.mapeo());
      this.resultado.set(r);
      this.toast.success(`Importadas ${r.nuevos} nueva(s)`, r.errores.length ? `${r.errores.length} con error.` : undefined);
      await this.cargarHistorial();
    } catch (e2) {
      this.toast.errorFrom(e2, 'No se pudo importar');
    } finally {
      this.procesando.set(false);
    }
  }

  reiniciar() {
    this.paso.set(1); this.entidad.set(null); this.headers.set([]); this.rows.set([]);
    this.mapeo.set({}); this.nombreArchivo.set(''); this.resultado.set(null);
  }

  /** Descarga una plantilla .xlsx con los encabezados + 2 filas de ejemplo. */
  async descargarPlantilla(e: EntidadImportable) {
    const ejemplo: Record<string, string> = {};
    for (const c of e.campos) ejemplo[c.label] = c.requerido ? '(obligatorio)' : '';
    await exportarExcel(`plantilla-${e.key}`, [ejemplo, { ...ejemplo }]);
  }

  async deshacer(id: string) {
    if (!confirm('¿Deshacer esta importación? Se borran solo las filas que creó (las actualizadas quedan).')) return;
    try {
      const n = await this.svc.deshacer(id);
      this.toast.success(`Deshecha: ${n} fila(s) borrada(s)`);
      await this.cargarHistorial();
    } catch (e) {
      this.toast.error('No se pudo deshacer', e instanceof Error ? humanizeError(e).mensaje : undefined);
    }
  }

  colValor(row: Record<string, unknown>, campo: string): string {
    const col = this.mapeo()[campo];
    const v = col ? row[col] : '';
    return v == null ? '' : String(v);
  }
}
