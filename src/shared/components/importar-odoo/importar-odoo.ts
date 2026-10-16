import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import * as XLSX from 'xlsx';
import { ImportadorService, ENTIDADES, EntidadImportable, ResultadoImport } from '../../services/importador.service';
import { ToastService } from '../../services/toast.service';
import { exportarExcel } from '../../utils/exportar-excel.util';
import { humanizeError } from '../../utils/friendly-error.util';
import { TranslatePipe } from '../../i18n/translate.pipe';

/** Resumen de fotos emparejadas/sin emparejar tras un import (.zip opcional). */
export interface ResultadoFotos {
  subidas: number;
  sinMatch: string[]; // nombres de archivo del Excel que no aparecieron en el .zip
}

/**
 * CC4 (#87) — Asistente "Importar desde Odoo", reutilizable en su módulo.
 * `entidad` fija (proveedores/vehiculos/articulos) → preselecciona y bloquea el paso 1.
 * Sin `entidad` (/admin/importar) → elige entre todas (Tecnología). Perfiles de Odoo:
 * etiquetas ES/EN + técnicos, ID externo → odoo_ref (idempotencia), transformaciones
 * (RNC, teléfono, relacional hoja, UoM, booleanos) + fusión de filas de continuación.
 */
@Component({
  selector: 'app-importar-odoo',
  imports: [DatePipe, TranslatePipe],
  templateUrl: './importar-odoo.html',
  styleUrl: './importar-odoo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportarOdoo implements OnInit {
  private svc = inject(ImportadorService);
  private toast = inject(ToastService);

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

  preview = computed(() => this.rows().slice(0, 8));
  camposRequeridosFaltan = computed(() => {
    const e = this.entidad(); if (!e) return [];
    const m = this.mapeo();
    return e.campos.filter((c) => c.requerido && !m[c.t]).map((c) => c.label);
  });

  async ngOnInit() {
    await this.cargarHistorial();
    const fija = this.entidadFija();
    if (fija) {
      const e = ENTIDADES.find((x) => x.key === fija);
      if (e) await this.elegirEntidad(e);
    }
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

  async onArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.nombreArchivo.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      let rows: Record<string, unknown>[];
      if (/\.csv$/i.test(file.name)) {
        rows = this.parseCsv(buf);
      } else {
        const wb = XLSX.read(buf, { cellDates: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      }
      if (!rows.length) { this.toast.warning('El archivo no tiene filas'); return; }
      this.rows.set(rows);
      this.headers.set(Object.keys(rows[0]));
      const e = this.entidad()!;
      this.mapeo.set({ ...this.svc.autoMapeo(e, this.headers()), ...this.mapeo() });
      this.paso.set(3);
    } catch (e) {
      this.toast.error('No se pudo leer el archivo', e instanceof Error ? e.message : undefined);
    } finally {
      input.value = '';
    }
  }

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

  /** Lee el .zip de fotos (opcional) y lo deja listo para emparejar por nombre al importar. */
  async onZip(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
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
      this.zipFotos.set(mapa);
      if (mapa.size === 0) this.toast.warning('El .zip no tiene archivos de imagen');
    } catch (e) {
      this.toast.error('No se pudo leer el .zip', e instanceof Error ? e.message : undefined);
      this.zipFotos.set(null);
      this.nombreZip.set('');
    } finally {
      input.value = '';
    }
  }

  quitarZip() {
    this.zipFotos.set(null);
    this.nombreZip.set('');
  }

  /** Sube las fotos del .zip emparejadas por `archivo_foto` ↔ nombre de archivo, usando
   *  el id real que devolvió el RPC para cada fila. Best-effort: un fallo por foto no
   *  revierte el import de datos, solo queda listado en "sin emparejar". */
  private async subirFotosImportadas(e: EntidadImportable, filas: Record<string, unknown>[], r: ResultadoImport): Promise<ResultadoFotos | null> {
    const foto = e.foto;
    const zip = this.zipFotos();
    if (!foto || !zip || zip.size === 0) return null;
    const idPorFila = new Map(r.filas.map((f) => [f.i, f.id]));
    let subidas = 0;
    const sinMatch: string[] = [];
    for (let i = 0; i < filas.length; i++) {
      const nombreArchivo = String(filas[i][foto.campoArchivo] ?? '').trim();
      if (!nombreArchivo) continue;
      const id = idPorFila.get(i + 1);
      const blob = zip.get(nombreArchivo);
      if (!id || !blob) { sinMatch.push(nombreArchivo); continue; }
      try {
        await this.svc.subirFoto(e, id, nombreArchivo, blob);
        subidas++;
      } catch {
        sinMatch.push(nombreArchivo);
      }
    }
    return { subidas, sinMatch };
  }

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
      const detalle = [
        r.errores.length ? `${r.errores.length} con error.` : '',
        fotos ? `${fotos.subidas} foto(s) subida(s)${fotos.sinMatch.length ? `, ${fotos.sinMatch.length} sin emparejar` : ''}.` : '',
      ].filter(Boolean).join(' ');
      this.toast.success(`Importadas ${r.nuevos} nueva(s)`, detalle || undefined);
      await this.cargarHistorial();
    } catch (e2) {
      this.toast.errorFrom(e2, 'No se pudo importar');
    } finally {
      this.procesando.set(false);
    }
  }

  reiniciar() {
    // Bloqueada → vuelve a subir archivo (paso 2), no al selector de entidad.
    this.headers.set([]); this.rows.set([]); this.mapeo.set({});
    this.nombreArchivo.set(''); this.resultado.set(null);
    this.zipFotos.set(null); this.nombreZip.set(''); this.resultadoFotos.set(null);
    this.fuente.set('plantilla');
    if (this.bloqueada()) { this.paso.set(2); void this.elegirEntidad(this.entidad()!); }
    else { this.paso.set(1); this.entidad.set(null); }
  }

  /** Plantilla SGC (sin Odoo): encabezados propios + ejemplo. */
  async descargarPlantillaSgc(e: EntidadImportable) {
    const ejemplo: Record<string, string> = {};
    for (const c of e.campos) if (c.t !== 'odoo_ref') ejemplo[c.label] = c.requerido ? '(obligatorio)' : '';
    await exportarExcel(`plantilla-sgc-${e.key}`, [ejemplo, { ...ejemplo }]);
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
