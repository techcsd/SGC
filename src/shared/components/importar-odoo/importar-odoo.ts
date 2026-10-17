import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import * as XLSX from 'xlsx';
import { ImportadorService, ENTIDADES, EntidadImportable, ResultadoImport, CambiosFila } from '../../services/importador.service';
import { ToastService } from '../../services/toast.service';
import { exportarExcel } from '../../utils/exportar-excel.util';
import { humanizeError } from '../../utils/friendly-error.util';
import { TranslatePipe } from '../../i18n/translate.pipe';
import { FormDrawer } from '../form-drawer/form-drawer';

/** Resumen de fotos subidas tras un import (.zip opcional). `sinUsar` son archivos
 *  del .zip que no coincidieron con ninguna fila — señal real de un nombre mal
 *  escrito (no "le faltó foto a una fila", que es normal y no se reporta como error). */
export interface ResultadoFotos {
  subidas: number;
  sinUsar: string[];
}

/** CQ4-c — una fila afectada por la importación, lista para pintar en el modal de
 *  resultado: datos clave + qué cambió + la foto (si quedó emparejada/subida). */
interface RegistroResultado {
  i: number;
  id: string;
  accion: 'creado' | 'actualizado';
  cambios: CambiosFila;
  resumen: string;     // "XT9317 · Volkswagen Golf 2015" / "00112345678 · Juan Pérez"
  fotoUrl: string | null;
}

// CQ4-a — marca de "es la plantilla del SGC" en una hoja oculta `_sgc`.
const MARCA_SGC_HOJA = '_sgc';
const MARCA_SGC_VERSION = 1;

/**
 * CC4 (#87) — Asistente "Importar desde Odoo", reutilizable en su módulo.
 * `entidad` fija (proveedores/vehiculos/articulos/conductores) → preselecciona y
 * bloquea el paso 1. Sin `entidad` (/admin/importar) → elige entre todas (Tecnología).
 * CQ4 — arreglo del mapeo (el auto-mapeo manda), drag&drop, miniaturas/emparejado de
 * fotos con asignación manual, detección de la plantilla propia del SGC (salta el
 * mapeo), y modal de resultado con "qué cambió" por fila.
 */
@Component({
  selector: 'app-importar-odoo',
  imports: [DatePipe, TranslatePipe, RouterLink, FormDrawer],
  templateUrl: './importar-odoo.html',
  styleUrl: './importar-odoo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportarOdoo implements OnInit {
  private svc = inject(ImportadorService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  /** CC4 — entidad fija ('proveedores'|'vehiculos'|'articulos'|'conductores') o null (elige
   *  todas). Alias 'entidad' — las páginas que embeben el componente usan `entidad="..."`. */
  entidadFija = input<string | null>(null, { alias: 'entidad' });

  entidades = ENTIDADES;
  bloqueada = computed(() => !!this.entidadFija());
  paso = signal<1 | 2 | 3 | 4>(1);
  entidad = signal<EntidadImportable | null>(null);
  headers = signal<string[]>([]);
  rows = signal<Record<string, unknown>[]>([]);
  mapeo = signal<Record<string, string>>({});
  nombreArchivo = signal('');
  // Solo aplica a entidades con perfil Odoo (e.odoo) — cuál tarjeta de origen
  // está activa en el paso "Sube el archivo". Entidades sin Odoo (choferes)
  // no muestran la elección: van directo a la plantilla propia.
  fuente = signal<'plantilla' | 'odoo'>('plantilla');
  procesando = signal(false);
  resultado = signal<ResultadoImport | null>(null);
  // Fotos por .zip (opcional) — solo si la entidad lo admite (entidad().foto).
  zipFotos = signal<Map<string, Blob> | null>(null);
  nombreZip = signal('');
  resultadoFotos = signal<ResultadoFotos | null>(null);
  historial = signal<{ id: string; entidad: string; nuevos: number; actualizados: number; errores: unknown[]; deshecha_at: string | null; created_at: string }[]>([]);

  // CQ4-a — detectó la hoja oculta `_sgc` de SU propia plantilla: auto-mapeo 100%,
  // salta el paso de mapeo. `mapeoForzado` = el usuario pidió verlo/editarlo igual.
  esPlantillaSgc = signal(false);
  mapeoForzado = signal(false);

  // CQ4-b — dropzones (excel/csv y .zip) con estado visual de "arrastrando encima".
  dragExcel = signal(false);
  dragZip = signal(false);
  private excelInput = viewChild<ElementRef<HTMLInputElement>>('excelInput');
  private zipInput = viewChild<ElementRef<HTMLInputElement>>('zipInput');

  // CQ4-c — asignación manual de fotos "sin dueño" a una fila (o quitar una ya
  // emparejada). Clave: índice de fila (0-based en `rows()`); '' = quitada a mano.
  fotoOverride = signal<Map<number, string>>(new Map());
  // nombre de archivo del .zip → URL local (createObjectURL), para las miniaturas.
  private fotoUrls = signal<Map<string, string>>(new Map());
  // Vista ampliada de una miniatura (fila o "sin dueño") con acciones.
  lightbox = signal<{ nombre: string; url: string; filaIndex: number | null } | null>(null);
  moviendoFoto = signal(false); // true = mostrando el <select> "mover/asignar a…" dentro del lightbox

  // CQ4-d — registros para el modal de resultado (una vez importó).
  registrosResultado = signal<RegistroResultado[]>([]);

  preview = computed(() => this.rows().slice(0, 8));
  camposRequeridosFaltan = computed(() => {
    const e = this.entidad(); if (!e) return [];
    const m = this.mapeo();
    return e.campos.filter((c) => c.requerido && !m[c.t]).map((c) => c.label);
  });

  // CQ4-c — filas ya mapeadas (lo que de verdad se importa), para emparejar fotos
  // contra el valor REAL del campo clave (no la columna cruda del Excel).
  filasMapeadas = computed<Record<string, unknown>[]>(() => {
    const e = this.entidad();
    return e ? this.svc.aplicarMapeo(e, this.rows(), this.mapeo()) : [];
  });
  private matchAutomatico = computed<Map<number, string>>(() => {
    const e = this.entidad();
    if (!e) return new Map();
    return this.svc.emparejarFotos(e, this.filasMapeadas(), this.zipFotos());
  });
  /** CQ4-c — emparejado final: automático + overrides manuales ('' = quitada). */
  matchFinal = computed<Map<number, string>>(() => {
    const out = new Map(this.matchAutomatico());
    for (const [i, nombre] of this.fotoOverride()) {
      if (nombre) out.set(i, nombre);
      else out.delete(i);
    }
    return out;
  });
  /** CQ4-c — fotos del .zip que no quedaron asignadas a ninguna fila. */
  fotosSinDueno = computed<string[]>(() => {
    const zip = this.zipFotos();
    if (!zip) return [];
    const usadas = new Set(this.matchFinal().values());
    return [...zip.keys()].filter((n) => !usadas.has(n));
  });

  async ngOnInit() {
    await this.cargarHistorial();
    const fija = this.entidadFija();
    if (fija) {
      const e = ENTIDADES.find((x) => x.key === fija);
      if (e) await this.elegirEntidad(e);
    }
    this.destroyRef.onDestroy(() => this.revocarUrls());
  }
  private async cargarHistorial() {
    try { this.historial.set(await this.svc.historial()); } catch { /* best-effort */ }
  }

  async elegirEntidad(e: EntidadImportable) {
    this.entidad.set(e);
    this.paso.set(2);
    this.fuente.set('plantilla');
    try { this.mapeo.set(await this.svc.mapeoRecordado(e.key)); } catch { /* nuevo */ }
  }

  // ── Paso 2: subir archivo (input clásico + drag&drop) ───────────────────────

  async onArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.procesarArchivo(file);
  }
  onDragOverExcel(ev: DragEvent) { ev.preventDefault(); this.dragExcel.set(true); }
  onDragLeaveExcel(ev: DragEvent) { ev.preventDefault(); this.dragExcel.set(false); }
  async onDropExcel(ev: DragEvent) {
    ev.preventDefault(); this.dragExcel.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) await this.procesarArchivo(file);
  }
  abrirSelectorExcel() { this.excelInput()?.nativeElement.click(); }
  onKeydownExcel(ev: KeyboardEvent) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.abrirSelectorExcel(); }
  }

  private async procesarArchivo(file: File) {
    this.nombreArchivo.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      let rows: Record<string, unknown>[];
      let esPlantilla = false;
      if (/\.csv$/i.test(file.name)) {
        rows = this.parseCsv(buf);
      } else {
        const wb = XLSX.read(buf, { cellDates: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        esPlantilla = this.leerMarcaSgc(wb, this.entidad()!.key);
      }
      if (!rows.length) { this.toast.warning('El archivo no tiene filas'); return; }
      this.rows.set(rows);
      this.headers.set(Object.keys(rows[0]));
      const e = this.entidad()!;
      // CQ4-a — el auto-mapeo manda: lo recordado solo rellena huecos con columnas
      // que SÍ existen en este archivo (antes era al revés y pisaba todo).
      const auto = this.svc.autoMapeo(e, this.headers());
      this.mapeo.set(this.svc.fusionarMapeoRecordado(auto, this.mapeo(), this.headers()));
      this.esPlantillaSgc.set(esPlantilla);
      this.mapeoForzado.set(false);
      this.fotoOverride.set(new Map());
      // Plantilla propia reconocida → directo a "Revisa y confirma" (paso 4).
      // Cualquier otro archivo (Odoo u otro) → paso 3, mapeo visible.
      this.paso.set(esPlantilla && !this.camposRequeridosFaltan().length ? 4 : 3);
    } catch (e) {
      this.toast.error('No se pudo leer el archivo', e instanceof Error ? e.message : undefined);
    }
  }

  /** CQ4-a — ¿trae la hoja oculta `_sgc` con `entidad=<key>`? (generada por `descargarPlantillaSgc`). */
  private leerMarcaSgc(wb: XLSX.WorkBook, entidadKey: string): boolean {
    const hoja = wb.Sheets[MARCA_SGC_HOJA];
    if (!hoja) return false;
    try {
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1 });
      const valor = filas?.[1]?.[0];
      return String(valor ?? '') === entidadKey;
    } catch { return false; }
  }

  /** Permite re-abrir el mapeo aunque la plantilla haya automapeado todo. */
  editarMapeo() { this.mapeoForzado.set(true); this.paso.set(3); }

  /** CC4 — CSV con `,`/`;` y UTF-8/Latin-1 (Odoo exporta con `;` en locales ES). */
  private parseCsv(buf: ArrayBuffer): Record<string, unknown>[] {
    const bytes = new Uint8Array(buf);
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.includes('�')) text = new TextDecoder('latin1').decode(bytes); // fallback Latin-1
    text = text.replace(/^﻿/, '');
    const primera = (text.split(/\r?\n/)[0] ?? '');
    const delim = (primera.split(';').length > primera.split(',').length) ? ';' : ',';
    const lineas = this.splitCsvLines(text);
    if (!lineas.length) return [];
    const heads = this.splitCsvRow(lineas[0], delim);
    const out: Record<string, unknown>[] = [];
    for (let i = 1; i < lineas.length; i++) {
      if (!lineas[i].trim()) continue;
      const cells = this.splitCsvRow(lineas[i], delim);
      const row: Record<string, unknown> = {};
      heads.forEach((h, j) => { row[h] = cells[j] ?? ''; });
      out.push(row);
    }
    return out;
  }
  private splitCsvLines(text: string): string[] {
    const lines: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { q = !q; cur += c; }
      else if ((c === '\n' || c === '\r') && !q) { if (c === '\r' && text[i + 1] === '\n') i++; lines.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  private splitCsvRow(line: string, delim: string): string[] {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  setMapeo(campo: string, col: string) { this.mapeo.update((m) => ({ ...m, [campo]: col })); }

  /** Label del campo clave usado para emparejar fotos (p.ej. "Cédula", "Placa"). */
  claveLabel(e: EntidadImportable): string {
    const campo = e.foto?.campoClave;
    return e.campos.find((c) => c.t === campo)?.label ?? campo ?? '';
  }
  /** Ejemplo de nombre de archivo para la ayuda del .zip, según el campo clave. */
  claveEjemplo(e: EntidadImportable): string {
    switch (e.foto?.campoClave) {
      case 'cedula': return '00112345678';
      case 'placa': return 'G675571';
      default: return 'archivo';
    }
  }

  // ── .zip de fotos (input clásico + drag&drop) ───────────────────────────────

  async onZip(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.procesarZip(file);
  }
  onDragOverZip(ev: DragEvent) { ev.preventDefault(); this.dragZip.set(true); }
  onDragLeaveZip(ev: DragEvent) { ev.preventDefault(); this.dragZip.set(false); }
  async onDropZip(ev: DragEvent) {
    ev.preventDefault(); this.dragZip.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) await this.procesarZip(file);
  }
  abrirSelectorZip() { this.zipInput()?.nativeElement.click(); }
  onKeydownZip(ev: KeyboardEvent) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.abrirSelectorZip(); }
  }

  /** Lee el .zip de fotos (opcional) y lo deja listo para emparejar por nombre al importar. */
  private async procesarZip(file: File) {
    this.nombreZip.set(file.name);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      const mapa = new Map<string, Blob>();
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const nombre = path.split('/').pop() ?? path;
        mapa.set(nombre, await entry.async('blob'));
      }
      this.revocarUrls();
      const urls = new Map<string, string>();
      for (const [nombre, blob] of mapa) urls.set(nombre, URL.createObjectURL(blob));
      this.fotoUrls.set(urls);
      this.zipFotos.set(mapa);
      this.fotoOverride.set(new Map());
      if (mapa.size === 0) this.toast.warning('El .zip no tiene archivos de imagen');
    } catch (e) {
      this.toast.error('No se pudo leer el .zip', e instanceof Error ? e.message : undefined);
      this.zipFotos.set(null);
      this.nombreZip.set('');
    }
  }

  quitarZip() {
    this.revocarUrls();
    this.zipFotos.set(null);
    this.nombreZip.set('');
    this.fotoOverride.set(new Map());
  }

  private revocarUrls() {
    for (const url of this.fotoUrls().values()) URL.revokeObjectURL(url);
    this.fotoUrls.set(new Map());
  }

  // ── CQ4-c: miniaturas + "sin dueño" + lightbox ──────────────────────────────

  /** URL local (ya creada) de una foto del .zip por su nombre de archivo. */
  urlFoto(nombre: string | undefined): string | null {
    if (!nombre) return null;
    return this.fotoUrls().get(nombre) ?? null;
  }
  /** Nombre del archivo emparejado con una fila del preview (por índice), si lo hay. */
  fotoDeFila(indice: number): string | undefined {
    return this.matchFinal().get(indice);
  }
  /** Etiqueta legible de una fila para el selector "¿De cuál es?" (clave + nombre/marca). */
  etiquetaFila(e: EntidadImportable, indice: number): string {
    const fila = this.filasMapeadas()[indice] ?? {};
    const clave = String(fila[e.foto?.campoClave ?? ''] ?? '').trim();
    const extra = e.key === 'vehiculos'
      ? [fila['marca'], fila['modelo']].filter(Boolean).join(' ')
      : e.key === 'conductores' ? String(fila['nombre'] ?? '') : '';
    return extra ? `${clave} · ${extra}` : clave || `Fila ${indice + 1}`;
  }
  /** Filas visibles (preview) con índice real — para el <select> de asignación manual. */
  filasPreviewConIndice(): { indice: number; label: string }[] {
    const e = this.entidad();
    if (!e) return [];
    return this.preview().map((_, i) => ({ indice: i, label: this.etiquetaFila(e, i) }));
  }

  asignarFotoAFila(nombre: string, indice: number) {
    // Si venimos de "mover a otra fila" desde el lightbox de una fila, esa fila de
    // origen pierde la foto (si no, quedaría duplicada: en la de origen por el match
    // automático y en la nueva por la asignación manual).
    const origen = this.lightbox()?.filaIndex;
    this.fotoOverride.update((m) => {
      const out = new Map(m);
      if (origen != null && origen !== indice) out.set(origen, '');
      // Si otra fila tenía esta misma foto asignada a mano, se la quitamos (una foto, un dueño).
      for (const [i, n] of out) if (n === nombre && i !== indice) out.set(i, '');
      out.set(indice, nombre);
      return out;
    });
    this.lightbox.set(null);
    this.moviendoFoto.set(false);
  }
  quitarFotoDeFila(indice: number) {
    this.fotoOverride.update((m) => new Map(m).set(indice, ''));
    this.lightbox.set(null);
    this.moviendoFoto.set(false);
  }

  abrirLightboxFila(indice: number) {
    const nombre = this.fotoDeFila(indice);
    const url = this.urlFoto(nombre);
    if (!nombre || !url) return;
    this.lightbox.set({ nombre, url, filaIndex: indice });
    this.moviendoFoto.set(false);
  }
  abrirLightboxSinDueno(nombre: string) {
    const url = this.urlFoto(nombre);
    if (!url) return;
    this.lightbox.set({ nombre, url, filaIndex: null });
    this.moviendoFoto.set(false);
  }
  cerrarLightbox() { this.lightbox.set(null); this.moviendoFoto.set(false); }

  irAPreview() {
    if (this.camposRequeridosFaltan().length) {
      this.toast.warning('Faltan columnas', 'Mapea: ' + this.camposRequeridosFaltan().join(', '));
      return;
    }
    this.paso.set(4);
  }

  /** Valor + nota de transformación (para el preview: "categ 'A / B / C' → C"). */
  celda(row: Record<string, unknown>, t: string): { valor: string; nota?: string } {
    const e = this.entidad(); const col = this.mapeo()[t];
    const def = e?.campos.find((c) => c.t === t);
    const raw = col ? row[col] : '';
    if (!def) return { valor: raw == null ? '' : String(raw) };
    const r = this.svc.transformar(def, raw);
    return { valor: r.valor == null ? '' : String(r.valor), nota: r.nota };
  }

  async importar() {
    const e = this.entidad();
    if (!e || this.procesando()) return;
    this.procesando.set(true);
    try {
      const filas = this.svc.aplicarMapeo(e, this.rows(), this.mapeo());
      const id = await this.svc.crearImportacion(e.key, filas.length);
      const r = await this.svc.importar(e, filas, id);
      await this.svc.registrarResultado(id, r);
      await this.svc.guardarMapeo(e.key, this.mapeo());
      this.resultado.set(r);
      const fotos = await this.subirFotosImportadas(e, filas, r);
      this.resultadoFotos.set(fotos);
      this.registrosResultado.set(this.construirRegistrosResultado(e, filas, r));
      const detalle = [
        r.errores.length ? `${r.errores.length} con error.` : '',
        fotos ? `${fotos.subidas} foto(s) subida(s)${fotos.sinUsar.length ? `, ${fotos.sinUsar.length} del .zip sin usar` : ''}.` : '',
      ].filter(Boolean).join(' ');
      this.toast.success(`Importadas ${r.nuevos} nueva(s)`, detalle || undefined);
      await this.cargarHistorial();
    } catch (e2) {
      this.toast.errorFrom(e2, 'No se pudo importar');
    } finally {
      this.procesando.set(false);
    }
  }

  /** Empareja cada foto del .zip con su fila (vía el match ya calculado, incl.
   *  asignaciones manuales) y sube cada una al registro ya creado/actualizado. Solo
   *  reporta "sin usar" los archivos del .zip que de verdad no quedaron asignados
   *  (típico: nombre mal escrito); que una fila no tenga foto es normal. */
  private async subirFotosImportadas(e: EntidadImportable, filas: Record<string, unknown>[], r: ResultadoImport): Promise<ResultadoFotos | null> {
    const foto = e.foto;
    const zip = this.zipFotos();
    if (!foto || !zip || zip.size === 0) return null;
    const idPorFila = new Map(r.filas.map((f) => [f.i, f.id]));
    const match = this.matchFinal();
    let subidas = 0;
    const usadas = new Set<string>();
    for (const [indice, nombreArchivo] of match) {
      const id = idPorFila.get(indice + 1);
      const blob = zip.get(nombreArchivo);
      if (!id || !blob) continue;
      try {
        await this.svc.subirFoto(e, id, nombreArchivo, blob);
        subidas++;
        usadas.add(nombreArchivo);
      } catch { /* best-effort — la fila ya se importó igual */ }
    }
    const sinUsar = [...zip.keys()].filter((n) => !usadas.has(n));
    return { subidas, sinUsar };
  }

  /** CQ4-d — arma los registros del modal de resultado: resumen + qué cambió + foto. */
  private construirRegistrosResultado(e: EntidadImportable, filas: Record<string, unknown>[], r: ResultadoImport): RegistroResultado[] {
    const match = this.matchFinal();
    return r.filas
      .filter((f) => !!f.id)
      .map((f) => {
        const indice = f.i - 1;
        const fila = filas[indice] ?? {};
        const resumen = e.key === 'vehiculos'
          ? [fila['placa'], [fila['marca'], fila['modelo']].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
          : e.key === 'conductores'
            ? [fila['cedula'], fila['nombre']].filter(Boolean).join(' · ')
            : String(fila['nombre'] ?? fila['placa'] ?? '');
        const nombreFoto = match.get(indice);
        return {
          i: f.i, id: f.id,
          accion: f.accion ?? (r.nuevos > 0 && indice < r.nuevos ? 'creado' : 'actualizado'),
          cambios: f.cambios ?? {},
          resumen: resumen || `Fila ${f.i}`,
          fotoUrl: this.urlFoto(nombreFoto),
        };
      });
  }

  /** CQ4-d — lista legible de "qué cambió" para una tarjeta del modal de resultado. */
  cambiosLegibles(cambios: CambiosFila): string[] {
    const e = this.entidad();
    return Object.entries(cambios ?? {}).map(([campo, { antes, despues }]) => {
      const label = e?.campos.find((c) => c.t === campo)?.label ?? campo;
      const a = antes == null || antes === '' ? '—' : String(antes);
      const d = despues == null || despues === '' ? '—' : String(despues);
      return `${label}: ${a} → ${d}`;
    });
  }

  /** CQ4-d — ruta al perfil del registro (si la entidad tiene ficha con :id). */
  rutaPerfil(e: EntidadImportable, id: string): string | null {
    if (e.key === 'vehiculos') return `/flota/vehiculos/${id}`;
    if (e.key === 'conductores') return `/flota/conductores/${id}`;
    return null;
  }
  /** CQ4-d — ruta al listado de la entidad (botón "Ver en Vehículos/Choferes"). */
  rutaListado(e: EntidadImportable): string {
    if (e.key === 'vehiculos') return '/flota/vehiculos';
    if (e.key === 'conductores') return '/flota/conductores';
    if (e.key === 'proveedores') return '/compras/proveedores';
    return '/inventario/articulos';
  }
  /** CQ4-d — nombre del botón "Ver en {Vehículos|Choferes|…}". */
  labelListado(e: EntidadImportable): string {
    return `Ver en ${e.label}`;
  }

  cerrarResultado() {
    this.reiniciar();
  }

  /** CQ4-d — exporta las filas con error a un .xlsx (reutiliza exportarExcel ya usado). */
  async descargarErrores(e: EntidadImportable) {
    const r = this.resultado();
    if (!r?.errores.length) return;
    const filas = r.errores.map((err) => ({ Fila: err.i, Motivo: err.motivo }));
    await exportarExcel(`errores-importar-${e.key}`, filas);
  }

  reiniciar() {
    // Bloqueada → vuelve a subir archivo (paso 2), no al selector de entidad.
    this.headers.set([]); this.rows.set([]); this.mapeo.set({});
    this.nombreArchivo.set(''); this.resultado.set(null);
    this.revocarUrls();
    this.zipFotos.set(null); this.nombreZip.set(''); this.resultadoFotos.set(null);
    this.fuente.set('plantilla'); this.esPlantillaSgc.set(false); this.mapeoForzado.set(false);
    this.fotoOverride.set(new Map()); this.lightbox.set(null); this.registrosResultado.set([]);
    if (this.bloqueada()) { this.paso.set(2); void this.elegirEntidad(this.entidad()!); }
    else { this.paso.set(1); this.entidad.set(null); }
  }

  /** Plantilla SGC (sin Odoo): encabezados propios + ejemplo + hoja de Instrucciones
   *  + marca oculta `_sgc` (CQ4-a) para que re-subirla salte el mapeo automáticamente. */
  async descargarPlantillaSgc(e: EntidadImportable) {
    const fila: Record<string, string> = {};
    for (const c of e.campos) if (c.t !== 'odoo_ref') fila[c.label] = c.requerido ? '(obligatorio)' : '';

    const wb = XLSX.utils.book_new();
    const wsDatos = XLSX.utils.json_to_sheet([fila]);
    XLSX.utils.book_append_sheet(wb, wsDatos, 'Datos');

    const instrucciones: unknown[][] = [
      [`Plantilla SGC — ${e.label}`],
      [''],
      ['Campo', 'Obligatorio', 'Formato / valores válidos'],
      ...e.campos.filter((c) => c.t !== 'odoo_ref').map((c) => [
        c.label,
        c.requerido ? 'Sí' : 'No',
        this.notaFormato(c),
      ]),
    ];
    if (e.foto) {
      instrucciones.push(['']);
      instrucciones.push([`Fotos (opcional): nombra cada archivo del .zip con el valor de «${this.claveLabel(e)}» de la fila (ej. ${this.claveEjemplo(e)}.jpg) y súbelo junto al Excel.`]);
    }
    const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones as (string | number)[][]);
    wsInstr['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

    // CQ4-a — hoja oculta con la marca de "es la plantilla del SGC" (entidad + versión).
    const wsMarca = XLSX.utils.aoa_to_sheet([['entidad', 'version'], [e.key, MARCA_SGC_VERSION]]);
    XLSX.utils.book_append_sheet(wb, wsMarca, MARCA_SGC_HOJA);
    const idx = wb.SheetNames.indexOf(MARCA_SGC_HOJA);
    wb.Workbook = { Sheets: wb.SheetNames.map((_, i) => (i === idx ? { Hidden: 1 } : {})) };

    XLSX.writeFile(wb, `plantilla-sgc-${e.key}.xlsx`);
  }

  /** CQ4-e — texto de ayuda por campo para la hoja "Instrucciones" (SheetJS community
   *  no soporta listas desplegables de Excel con facilidad; documentamos los valores
   *  válidos como texto en vez de imponer validación de datos). */
  private notaFormato(c: EntidadImportable['campos'][number]): string {
    if (c.transform === 'fecha') return 'Fecha en formato AAAA-MM-DD';
    if (c.transform === 'numero') return 'Número (sin letras; se aceptan separadores de miles)';
    if (c.transform === 'bool') return 'Sí / No (o Verdadero / Falso)';
    if (c.opciones?.length) {
      const valores = c.opciones.map((o) => o.label).join(' · ');
      return c.transform === 'enum' ? `Uno de: ${valores}` : `Sugeridos: ${valores} (o cualquier otro texto)`;
    }
    return 'Texto libre';
  }

  /** Ejemplo con encabezados REALES de Odoo (para ver el formato que llega). */
  async descargarEjemploOdoo(e: EntidadImportable) {
    const fila: Record<string, string> = {};
    const H = EJEMPLO_ODOO[e.key] ?? {};
    for (const [h, v] of Object.entries(H)) fila[h] = v;
    await exportarExcel(`ejemplo-odoo-${e.key}`, [fila]);
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
}

// CC4 — ejemplo con los encabezados reales de un export de Odoo (para descarga).
const EJEMPLO_ODOO: Record<string, Record<string, string>> = {
  proveedores: {
    'ID': '__export__.res_partner_42_a1b2c3', 'Nombre': 'Ferretería Acero SRL', 'NIF/RNC': '1-31-12345-6',
    'Teléfono': '(809) 555-1234', 'Correo electrónico': 'ventas@acero.do', 'Calle': 'Av. Duarte 100',
    'Es una compañía': 'Verdadero', 'Activo': 'Verdadero',
  },
  vehiculos: {
    'ID': '__export__.fleet_vehicle_7_x9y8', 'Matrícula': 'A123456', 'Marca': 'Toyota', 'Modelo': 'Hilux', 'Color': 'Blanco', 'Tipo de vehículo': 'Camioneta',
  },
  articulos: {
    'ID': '__export__.product_template_9_z1', 'Nombre': 'Varilla 1/2', 'Referencia interna': 'VAR-12',
    'Categoría de producto': 'Todos / Materiales / Acero', 'Unidad de medida': 'Unidades',
  },
};
