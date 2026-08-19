import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CronogramaService } from '../../../../shared/services/cronograma.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { CronogramaTarea } from '../../../../shared/models/cronograma.model';
import { FaseProyecto } from '../../../../shared/models/proyecto.model';

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

/** G2/AS21 — estado de una fila en el diff vs lo ya guardado en el cronograma. */
type DiffEstado = 'nueva' | 'modificada' | 'sin_cambios' | 'eliminada';

/** G2/AS21 — un campo que cambió (antes → después) para una tarea modificada. */
interface CampoCambio {
  campo: string;
  antes: string;
  despues: string;
}

/** G2/AS21 — una fila del preview con su clasificación vs lo existente. */
interface FilaDiff {
  estado: DiffEstado;
  orden: number;
  nombre: string;
  grupo: string | null;
  responsable: string | null;
  volumetria: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  dias: number | null;
  avance_pct: number | null;
  cambios: CampoCambio[];
}

/** G2/AS21 — diff de una torre (fase) entre el Excel y lo ya guardado. */
interface HojaDiff {
  torre: string;
  faseExiste: boolean;
  nuevas: number;
  modificadas: number;
  sinCambios: number;
  eliminadas: number;
  warnings: string[];
  filas: FilaDiff[];
}

/**
 * AS21 — Importador de cronograma por Excel. Detecta la fila de headers de forma
 * tolerante, mapea columnas (#, ACTIVIDADES, RESPONSABLE, VOLUMETRÍA, FECHA
 * INICIO/FIN, DÍAS, STATUS, AVANCE REAL %, RENDIMIENTO) y arma un preview por
 * torre (hoja) con diff REAL vs lo ya guardado (nuevas / modificadas / sin
 * cambios / se eliminan), para que el usuario vea qué va a cambiar antes de
 * confirmar el reemplazo. Al confirmar, alimenta el cronograma existente (una
 * fase por torre) vía cronograma_importar (delete-then-insert por fase). Para
 * .mpp guía a exportar a Excel desde MS Project.
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
  private proyectosService = inject(ProyectosService);
  private toast = inject(ToastService);

  proyectoId = signal('');
  fileName = signal('');
  hojas = signal<HojaImport[]>([]);
  error = signal('');
  parsing = signal(false);
  importing = signal(false);
  esMpp = signal(false);

  // G2/AS21 — snapshot de lo ya guardado, para el diff.
  private fasesExistentes = signal<FaseProyecto[]>([]);
  private tareasExistentes = signal<CronogramaTarea[]>([]);
  cargandoExistente = signal(false);

  totalTareas = computed(() => this.hojas().reduce((s, h) => s + h.tareas.length, 0));

  /** G2/AS21 — diff por torre entre el Excel parseado y lo ya guardado. */
  diffs = computed<HojaDiff[]>(() => {
    const fases = this.fasesExistentes();
    const tareas = this.tareasExistentes();
    return this.hojas().map((h) => this.diffHoja(h, fases, tareas));
  });

  // Totales globales del diff (para el resumen).
  totalNuevas = computed(() => this.diffs().reduce((s, d) => s + d.nuevas, 0));
  totalModificadas = computed(() => this.diffs().reduce((s, d) => s + d.modificadas, 0));
  totalSinCambios = computed(() => this.diffs().reduce((s, d) => s + d.sinCambios, 0));
  totalEliminadas = computed(() => this.diffs().reduce((s, d) => s + d.eliminadas, 0));

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.proyectoId.set(id);
    if (id) void this.cargarExistente(id);
  }

  /** G2/AS21 — carga fases + tareas ya guardadas para comparar contra el Excel. */
  private async cargarExistente(id: string) {
    this.cargandoExistente.set(true);
    try {
      const [proy, data] = await Promise.all([
        this.proyectosService.getById(id),
        this.service.listar(id),
      ]);
      this.fasesExistentes.set(proy?.fases ?? []);
      this.tareasExistentes.set(data.tareas ?? []);
    } catch {
      // El diff es informativo: si no se pudo cargar, el preview cae a "todo nuevo".
    } finally {
      this.cargandoExistente.set(false);
    }
  }

  /** Clave estable de una actividad dentro de su torre: nombre + grupo/sección. */
  private claveTarea(nombre: string, grupo: string | null): string {
    return `${this.norm(nombre)}||${this.norm(grupo ?? '')}`;
  }

  private fechaIso(v: string | null): string | null {
    return v ? v.slice(0, 10) : null;
  }

  /** Duración efectiva que guardará el RPC (greatest(1, dias ?? 1)). */
  private diasEfectivos(dias: number | null): number {
    return Math.max(1, dias ?? 1);
  }

  private diffHoja(h: HojaImport, fases: FaseProyecto[], tareas: CronogramaTarea[]): HojaDiff {
    const faseId = fases.find((f) => this.norm(f.nombre) === this.norm(h.torre))?.id ?? null;
    const existentes = faseId ? tareas.filter((t) => t.fase_id === faseId) : [];
    const faseExiste = faseId != null;

    // Índice de lo existente por clave (para emparejar).
    const idxExistente = new Map<string, CronogramaTarea>();
    for (const t of existentes) idxExistente.set(this.claveTarea(t.nombre, t.grupo ?? null), t);

    const usadas = new Set<string>();
    const filas: FilaDiff[] = [];
    let nuevas = 0;
    let modificadas = 0;
    let sinCambios = 0;

    for (const t of h.tareas) {
      const clave = this.claveTarea(t.nombre, t.grupo);
      const prev = idxExistente.get(clave);
      const base: FilaDiff = {
        estado: 'nueva',
        orden: t.orden,
        nombre: t.nombre,
        grupo: t.grupo,
        responsable: t.responsable,
        volumetria: t.volumetria,
        fecha_inicio: t.fecha_inicio,
        fecha_fin: t.fecha_fin,
        dias: t.dias,
        avance_pct: t.avance_pct,
        cambios: [],
      };
      if (!prev) {
        nuevas++;
        filas.push(base);
        continue;
      }
      usadas.add(clave);
      const cambios = this.compararTarea(prev, t);
      if (cambios.length === 0) {
        sinCambios++;
        filas.push({ ...base, estado: 'sin_cambios' });
      } else {
        modificadas++;
        filas.push({ ...base, estado: 'modificada', cambios });
      }
    }

    // Existentes no emparejadas → se eliminan (el confirmar reemplaza la fase).
    const eliminadasFilas = existentes
      .filter((t) => !usadas.has(this.claveTarea(t.nombre, t.grupo ?? null)))
      .map<FilaDiff>((t) => ({
        estado: 'eliminada',
        orden: t.orden,
        nombre: t.nombre,
        grupo: t.grupo ?? null,
        responsable: t.responsable ?? null,
        volumetria: t.volumetria ?? null,
        fecha_inicio: this.fechaIso(t.fecha_inicio_plan),
        fecha_fin: this.fechaIso(t.fecha_fin_plan),
        dias: t.duracion_dias_plan,
        avance_pct: t.avance_pct ?? null,
        cambios: [],
      }));
    filas.push(...eliminadasFilas);

    return {
      torre: h.torre,
      faseExiste,
      nuevas,
      modificadas,
      sinCambios,
      eliminadas: eliminadasFilas.length,
      warnings: h.warnings,
      filas,
    };
  }

  /** Compara una tarea existente con la parseada y devuelve los campos cambiados. */
  private compararTarea(prev: CronogramaTarea, t: TareaImport): CampoCambio[] {
    const cambios: CampoCambio[] = [];
    const push = (campo: string, antes: unknown, despues: unknown) => {
      const a = antes == null || antes === '' ? '—' : String(antes);
      const d = despues == null || despues === '' ? '—' : String(despues);
      if (a !== d) cambios.push({ campo, antes: a, despues: d });
    };
    push('Inicio', this.fechaIso(prev.fecha_inicio_plan), t.fecha_inicio);
    push('Fin', this.fechaIso(prev.fecha_fin_plan), t.fecha_fin);
    push('Días', prev.duracion_dias_plan, this.diasEfectivos(t.dias));
    push('Responsable', prev.responsable ?? null, t.responsable);
    push('Volumetría', prev.volumetria ?? null, t.volumetria);
    push('Rendimiento', prev.rendimiento ?? null, t.rendimiento);
    push(
      'Avance',
      prev.avance_pct != null ? `${prev.avance_pct}%` : null,
      t.avance_pct != null ? `${Math.min(100, Math.max(0, t.avance_pct))}%` : null,
    );
    return cambios;
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
