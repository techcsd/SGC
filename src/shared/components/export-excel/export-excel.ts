import { Component, ChangeDetectionStrategy, input, signal, computed } from '@angular/core';
import { exportarExcel } from '../../utils/exportar-excel.util';

/** Una columna exportable: id estable, encabezado y cómo obtener su valor de la fila. */
export interface ExportColumn {
  key: string;
  label: string;
  value: (row: unknown) => unknown;
  /** Incluida por defecto (true si se omite). */
  default?: boolean;
}

/** Una "sección"/filtro del export: los valores a los que pertenece cada fila. */
export interface ExportSection {
  key: string;
  label: string;
  /** Valores (etiquetas) a los que pertenece la fila. Multi-valor permitido (roles, tags). */
  values: (row: unknown) => string[];
}

/**
 * Botón reutilizable de exportación a Excel con "secciones": además de descargar
 * toda la vista actual, permite seccionar el Excel (por estado, categoría, rol,
 * tags, etc.) y elegir qué columnas incluir. Cae en el patrón de todas las
 * páginas (exportar la vista filtrada), pero añade el seccionado a pedido.
 *
 * Uso:
 *   <app-export-excel filenameBase="conductores" [rows]="filtered()" [allRows]="conductores()"
 *      [columns]="EXPORT_COLS" [sections]="EXPORT_SECCIONES" />
 */
@Component({
  selector: 'app-export-excel',
  imports: [],
  templateUrl: './export-excel.html',
  styleUrl: './export-excel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportExcel {
  /** Nombre base del archivo (sin extensión ni fecha). */
  filenameBase = input.required<string>();
  /** Filas de la VISTA ACTUAL (lo que se ve en pantalla, ya filtrado). */
  rows = input.required<unknown[]>();
  /** Dataset completo (habilita la opción "Todos"). Opcional. */
  allRows = input<unknown[] | null>(null);
  columns = input.required<ExportColumn[]>();
  sections = input<ExportSection[]>([]);
  /** Etiqueta de la base "vista" (p. ej. "filtros actuales"). */
  vistaLabel = input('filtros actuales');

  dialogOpen = signal(false);
  base = signal<'vista' | 'todos'>('vista');
  /** Por sección: conjunto de valores seleccionados (vacío = todos). */
  private seccionSel = signal<Record<string, Set<string>>>({});
  /** Columnas incluidas (por key). */
  private colSel = signal<Set<string>>(new Set());
  exportando = signal(false);

  /** Filas base según la opción elegida (vista actual vs todos). */
  private baseRows = computed<unknown[]>(() => {
    const all = this.allRows();
    return this.base() === 'todos' && all ? all : this.rows();
  });

  /** Opciones por sección (valores distintos + conteo) sobre las filas base. */
  opcionesPorSeccion = computed(() => {
    const rows = this.baseRows();
    return this.sections().map((s) => {
      const counts = new Map<string, number>();
      for (const r of rows) {
        for (const v of s.values(r)) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const opciones = [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, count }));
      return { key: s.key, label: s.label, opciones };
    });
  });

  /** Filas que quedan tras aplicar el seccionado (para el conteo en vivo). */
  matching = computed<unknown[]>(() => {
    const sel = this.seccionSel();
    const secs = this.sections();
    return this.baseRows().filter((row) =>
      secs.every((s) => {
        const chosen = sel[s.key];
        if (!chosen || chosen.size === 0) return true; // sin selección = todos
        return s.values(row).some((v) => chosen.has(v));
      }),
    );
  });

  columnasIncluidas = computed(() =>
    this.columns().filter((c) => this.colSel().has(c.key)),
  );

  // ── UI ──────────────────────────────────────────────────────
  abrir() {
    // Inicializa columnas por defecto y limpia secciones.
    this.colSel.set(new Set(this.columns().filter((c) => c.default !== false).map((c) => c.key)));
    this.seccionSel.set({});
    this.base.set('vista');
    this.dialogOpen.set(true);
  }
  cerrar() {
    this.dialogOpen.set(false);
  }

  seccionActiva(secKey: string, value: string): boolean {
    return this.seccionSel()[secKey]?.has(value) ?? false;
  }
  toggleSeccion(secKey: string, value: string) {
    this.seccionSel.update((m) => {
      const next = { ...m };
      const set = new Set(next[secKey] ?? []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      next[secKey] = set;
      return next;
    });
  }
  limpiarSeccion(secKey: string) {
    this.seccionSel.update((m) => ({ ...m, [secKey]: new Set<string>() }));
  }

  colActiva(key: string): boolean {
    return this.colSel().has(key);
  }
  toggleCol(key: string) {
    this.colSel.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Descarga rápida: la vista actual completa, con las columnas por defecto. */
  async exportarRapido() {
    const cols = this.columns().filter((c) => c.default !== false);
    await this.generar(this.rows(), cols);
  }

  /** Descarga con el seccionado/columnas elegidos en el diálogo. */
  async descargar() {
    const cols = this.columnasIncluidas();
    if (cols.length === 0) return;
    await this.generar(this.matching(), cols);
    this.cerrar();
  }

  private async generar(rows: unknown[], cols: ExportColumn[]) {
    this.exportando.set(true);
    try {
      const filas = rows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const c of cols) obj[c.label] = c.value(r) ?? '';
        return obj;
      });
      await exportarExcel(this.filenameBase(), filas);
    } finally {
      this.exportando.set(false);
    }
  }
}
