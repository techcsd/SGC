import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CronogramaService } from '../../../../shared/services/cronograma.service';
import { ToastService } from '../../../../shared/services/toast.service';

/** AS21 — actividad parseada de una hoja del Excel. */
interface TareaImport {
  orden: number;
  nombre: string;
  responsable: string | null;
  volumetria: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  dias: number | null;
  avance_pct: number | null;
  rendimiento: string | null;
  grupo: string | null;
}

/** AS21 — una hoja del libro = una torre/etapa (fase). */
interface HojaImport {
  torre: string;
  headerRow: number | null;
  tareas: TareaImport[];
  warnings: string[];
}

/**
 * AS21 — Importador de cronograma por Excel. Detecta la fila de headers de forma
 * tolerante, mapea columnas (#, ACTIVIDADES, RESPONSABLE, VOLUMETRÍA, FECHA
 * INICIO/FIN, DÍAS, STATUS, AVANCE REAL %, RENDIMIENTO) y arma un preview por
 * torre (hoja) con diff vs lo existente. Al confirmar, alimenta el cronograma
 * existente (una fase por torre) vía cronograma_importar. Para .mpp guía a
 * exportar a Excel desde MS Project.
 */
@Component({
  selector: 'app-cronograma-import',
  imports: [RouterLink],
  templateUrl: './cronograma-import.html',
  styleUrl: './cronograma-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CronogramaImport implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(CronogramaService);
  private toast = inject(ToastService);

  proyectoId = signal('');
  fileName = signal('');
  hojas = signal<HojaImport[]>([]);
  error = signal('');
  parsing = signal(false);
  importing = signal(false);
  esMpp = signal(false);

  totalTareas = computed(() => this.hojas().reduce((s, h) => s + h.tareas.length, 0));

  ngOnInit() {
    this.proyectoId.set(this.route.snapshot.paramMap.get('id') ?? '');
  }

  private norm(s: unknown): string {
    return String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  private parseFecha(v: unknown): string | null {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, '0');
      const d = String(v.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(v).trim();
    // Formato del ejemplo: M/D/YY o M/D/YYYY.
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let [, mo, da, yr] = m;
      let year = Number(yr);
      if (year < 100) year += 2000;
      const iso = `${year}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
      return iso;
    }
    // ISO ya válido.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }

  private parseNum(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace('%', '').replace(/,/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.hojas.set([]);
    this.esMpp.set(false);
    this.fileName.set(file.name);

    if (/\.mpp$/i.test(file.name)) {
      this.esMpp.set(true);
      this.error.set(
        'Los archivos .mpp de MS Project no se pueden leer directamente. Ábrelo en MS Project y usa "Archivo → Guardar como / Exportar → Excel", luego súbelo aquí.',
      );
      return;
    }

    this.parsing.set(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const hojas: HojaImport[] = [];

      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        if (!sheet) continue;
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        });
        const parsed = this.parseHoja(name, aoa);
        if (parsed) hojas.push(parsed);
      }

      if (hojas.length === 0) {
        this.error.set('No se detectaron actividades. Revisa que la hoja tenga una fila de encabezados con "ACTIVIDADES".');
      }
      this.hojas.set(hojas);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      this.parsing.set(false);
    }
  }

  /** Detecta headers, mapea columnas y extrae actividades de una hoja. */
  private parseHoja(nombreHoja: string, aoa: unknown[][]): HojaImport | null {
    const warnings: string[] = [];
    // 1) Detectar la fila de headers (contiene "actividad").
    let headerRow = -1;
    for (let r = 0; r < Math.min(aoa.length, 25); r++) {
      const row = aoa[r] ?? [];
      if (row.some((c) => this.norm(c).includes('actividad'))) {
        headerRow = r;
        break;
      }
    }
    if (headerRow === -1) return null;

    // 2) Mapear columnas por encabezado.
    const header = (aoa[headerRow] ?? []).map((c) => this.norm(c));
    const findCol = (...keys: string[]) =>
      header.findIndex((h) => keys.some((k) => h === k || h.includes(k)));

    const cNum = findCol('#', 'no', 'item');
    const cNombre = findCol('actividad');
    const cResp = findCol('responsable');
    const cVol = findCol('volumetria', 'volumen');
    const cIni = findCol('fecha inicio', 'inicio');
    const cFin = findCol('fecha fin', 'fin', 'termino');
    const cDias = findCol('dias de ejecucion', 'dias');
    const cAvance = findCol('avance real', 'avance');
    const cRend = findCol('rendimiento');

    if (cNombre === -1) {
      warnings.push('No se encontró la columna ACTIVIDADES.');
      return { torre: nombreHoja, headerRow: headerRow + 1, tareas: [], warnings };
    }

    // 3) Extraer filas.
    const tareas: TareaImport[] = [];
    let grupo: string | null = null;
    let orden = 0;
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const nombre = String(row[cNombre] ?? '').trim();
      if (!nombre) continue;
      const numVal = cNum >= 0 ? this.parseNum(row[cNum]) : null;
      const esNumerada = numVal != null && numVal > 0;

      if (!esNumerada) {
        // Fila de sección/agrupador (p.ej. "ENTREPISO #").
        grupo = nombre;
        continue;
      }

      orden += 1;
      tareas.push({
        orden,
        nombre,
        responsable: cResp >= 0 ? (String(row[cResp] ?? '').trim() || null) : null,
        volumetria: cVol >= 0 ? (String(row[cVol] ?? '').trim() || null) : null,
        fecha_inicio: cIni >= 0 ? this.parseFecha(row[cIni]) : null,
        fecha_fin: cFin >= 0 ? this.parseFecha(row[cFin]) : null,
        dias: cDias >= 0 ? this.parseNum(row[cDias]) : null,
        avance_pct: cAvance >= 0 ? this.parseNum(row[cAvance]) : null,
        rendimiento: cRend >= 0 ? (String(row[cRend] ?? '').trim() || null) : null,
        grupo,
      });
    }

    if (tareas.length === 0) warnings.push('No se detectaron filas de actividad numeradas.');
    if (cIni === -1 || cFin === -1) warnings.push('Faltan columnas de fecha; las actividades quedarán sin fechas planificadas.');

    return { torre: nombreHoja, headerRow: headerRow + 1, tareas, warnings };
  }

  quitarHoja(torre: string) {
    this.hojas.update((list) => list.filter((h) => h.torre !== torre));
  }

  async confirmar() {
    if (this.importing()) return;
    const hojas = this.hojas().filter((h) => h.tareas.length > 0);
    if (hojas.length === 0) {
      this.error.set('No hay actividades para importar.');
      return;
    }
    this.importing.set(true);
    this.error.set('');
    let creadas = 0;
    let reemplazadas = 0;
    try {
      for (const h of hojas) {
        const res = await this.service.importar(
          this.proyectoId(),
          h.torre,
          h.tareas as unknown as Record<string, unknown>[],
          true,
        );
        creadas += res.creadas ?? 0;
        reemplazadas += res.reemplazadas ?? 0;
      }
      this.toast.success(
        'Cronograma importado',
        `${creadas} actividad(es) en ${hojas.length} torre(s)${reemplazadas ? `, ${reemplazadas} reemplazada(s)` : ''}.`,
      );
      this.router.navigate(['/proyectos', this.proyectoId(), 'cronograma']);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo importar el cronograma.');
    } finally {
      this.importing.set(false);
    }
  }
}
