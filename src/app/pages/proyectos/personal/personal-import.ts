import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonalObraService, ImportPersonalRow, ImportPersonalResultado, ImportPreview, CargoAlias } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { Cargo } from '../../../../shared/models/personal-obra.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Icon } from '../../../../shared/ui/icon/icon';

/** Fila previsualizada del import (antes de confirmar). */
interface FilaPrev {
  nombre: string;
  documento: string | null;
  nacionalidad: string;
  tipo_documento: string;
  cargo_id: string | null;
  cargo_origen: string;     // texto crudo del Excel (TECNICO / OCUPACION) usado para resolver/aprender
  cuadrilla: string | null; // AV4 — eje TECNICO (cuadrilla) crudo, título
  permiso_vencimiento: string | null; // CG2 — ISO yyyy-mm-dd parseado de OBSERVACION
  notas: string | null;
  estado: 'ok' | 'warning' | 'error';
  motivo: string;           // por qué warning/error
  yaExiste: boolean;        // dedupe contra la obra elegida
}

// AT5 — normaliza texto sucio (mayúsculas, acentos, espacios al final).
function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// CG2 — Diccionario base (red de seguridad offline). La fuente autoritativa y
// editable es la tabla `cargo_alias` (Proyectos › Cargos); estos solo evitan una
// regresión si el servidor aún no tiene el alias registrado.
const CARGO_DICT: Record<string, string> = {
  INGENIERO: 'ING', MAESTRO: 'MAE', CAPATAZ: 'CAP', 'CAPATAZ CSD': 'CAP',
  VARILLERO: 'VAR', FERRALLERO: 'FERR', CARPINTERO: 'CARP', ALBANIL: 'ALB',
  AYUDANTE: 'AYU', 'AYUDANTE CSD': 'AYU', PLOMERO: 'PLOM', ELECTRICISTA: 'ELEC',
  PINTOR: 'PINT', SOLDADOR: 'SOLD', VIGILANTE: 'VIG', OBRERO: 'AYU',
};

// Formato de cédula dominicana 000-0000000-0.
const CEDULA_RE = /^\d{3}-?\d{7}-?\d$/;

// CG2 — extrae una fecha DD/MM/YYYY del texto de OBSERVACION (permiso de trabajo).
// Acepta separadores / - . y años de 2 o 4 dígitos. Devuelve ISO yyyy-mm-dd o null.
function parsePermiso(obs: string | null): string | null {
  if (!obs) return null;
  const m = String(obs).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  let yy = +m[3];
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00');
  // rechaza fechas imposibles (p. ej. 31/02) y años absurdos
  if (isNaN(dt.getTime()) || dt.getMonth() + 1 !== mm || dt.getDate() !== dd) return null;
  if (yy < 2000 || yy > 2100) return null;
  return iso;
}

@Component({
  selector: 'app-personal-import',
  imports: [RouterLink, Icon],
  templateUrl: './personal-import.html',
  styleUrl: './personal-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalImport implements OnInit {
  private svc = inject(PersonalObraService);
  private proyectosSvc = inject(ProyectosService);
  private toast = inject(ToastService);

  paso = signal<'subir' | 'previsualizar' | 'diff' | 'resultado'>('subir');
  cargos = signal<Cargo[]>([]);
  aliasList = signal<CargoAlias[]>([]); // CG2 — alias aprendidos (texto sucio → cargo)
  obras = signal<ObraRef[]>([]);
  cargoById = computed(() => new Map(this.cargos().map((c) => [c.id, c] as const)));

  // CG2 — mapa resolutor: norm(texto) → cargo_id. Capas (la última gana):
  // 1) diccionario base offline, 2) código y nombre del catálogo, 3) alias curados en BD.
  resolverMap = computed(() => {
    const m = new Map<string, string>();
    const byCode = new Map(this.cargos().map((c) => [c.codigo, c.id] as const));
    for (const [txt, code] of Object.entries(CARGO_DICT)) {
      const id = byCode.get(code);
      if (id) m.set(norm(txt), id);
    }
    for (const c of this.cargos()) {
      m.set(norm(c.codigo), c.id);
      m.set(norm(c.nombre), c.id);
    }
    for (const a of this.aliasList()) {
      if (a.cargo_id) m.set(norm(a.alias_normalizado), a.cargo_id);
    }
    return m;
  });

  // CG2 — alias ya aprendidos en esta sesión (para no repetir la llamada al RPC).
  private aprendidos = new Set<string>();

  // Encabezado detectado del archivo.
  proyectoDetectado = signal<string>('');
  ubicacionDetectada = signal<string>('');
  encObra = signal<string>('');
  archivoNombre = signal<string>('');

  filas = signal<FilaPrev[]>([]);
  obraSeleccionada = signal<string | null>(null);
  modo = signal<'actualizar' | 'saltar'>('actualizar');
  procesando = signal(false);
  error = signal('');

  resultado = signal<ImportPersonalResultado | null>(null);
  ultimoLote = signal<string | null>(null);

  // AV4 — diff del ciclo (altas/actualizaciones/bajas) + bajas confirmadas por RRHH.
  preview = signal<ImportPreview | null>(null);
  bajasChecked = signal<Set<string>>(new Set());

  okCount = computed(() => this.filas().filter((f) => f.estado !== 'error').length);
  errCount = computed(() => this.filas().filter((f) => f.estado === 'error').length);
  dupCount = computed(() => this.filas().filter((f) => f.yaExiste).length);

  async ngOnInit() {
    try {
      const [cargos, obras] = await Promise.all([this.svc.getCargos(), this.proyectosSvc.getDirectorio('personal')]);
      this.cargos.set(cargos);
      this.obras.set(obras);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar catálogos.');
    }
    // CG2 — los alias no bloquean la carga; si fallan, el diccionario base cubre.
    try {
      this.aliasList.set(await this.svc.listarCargoAlias());
    } catch { /* red de seguridad: resolverMap sigue con catálogo + diccionario base */ }
  }

  /** CG2 — resuelve un texto crudo a cargo_id (alias → código → nombre → diccionario). */
  private resolverCargo(raw: unknown): string | null {
    const key = norm(raw);
    if (!key) return null;
    return this.resolverMap().get(key) ?? null;
  }

  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.archivoNombre.set(file.name);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
      this.parsear(rows);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }

  private parsear(rows: unknown[][]) {
    // Encabezado de obra (PROYECTO / UBICACIÓN / ENC. OBRA en la col B).
    for (const r of rows) {
      const label = norm(r[1]);
      if (label === 'PROYECTO') this.proyectoDetectado.set(String(r[2] ?? '').trim());
      if (label === 'UBICACION') this.ubicacionDetectada.set(String(r[2] ?? '').trim());
      if (label.startsWith('ENC')) this.encObra.set(String(r[2] ?? '').trim());
    }

    // Fila de headers = donde aparece 'NOMBRE'.
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some((c) => norm(c) === 'NOMBRE')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) { this.error.set('No se encontró la fila de encabezados (NOMBRE, OCUPACION, # DE DOCUMENTO…).'); return; }

    const header = rows[headerIdx].map((c) => norm(c));
    const col = (nombres: string[]) => header.findIndex((h) => nombres.some((n) => h === n || h.startsWith(n)));
    const iNombre = col(['NOMBRE']);
    const iOcup = col(['OCUPACION']);
    const iDoc = col(['# DE DOCUMENTO', 'DOCUMENTO', '# DOC']);
    const iNac = col(['NACIONALIDAD']);
    const iTec = col(['TECNICO']);
    const iObs = col(['OBSERVACION', 'OBSERVACION.']);

    const filas: FilaPrev[] = [];
    const vistos = new Set<string>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const nombreRaw = String(r[iNombre] ?? '').trim();
      if (!nombreRaw) continue;               // fila vacía
      if (norm(nombreRaw) === 'NOMBRE') continue; // re-header

      const tecRaw = String(r[iTec] ?? '').trim();
      const ocupRaw = String(r[iOcup] ?? '').trim();
      const doc = String(r[iDoc] ?? '').trim() || null;
      const nacRaw = norm(r[iNac]);
      const obs = String(r[iObs] ?? '').trim() || null;

      // Nacionalidad ("DOMINICANO Y HTI" → haitiano; cualquier mención HT/HAIT → haitiano).
      let nacionalidad = 'otro';
      if (nacRaw.includes('HT') || nacRaw.includes('HAIT')) nacionalidad = 'haitiano';
      else if (nacRaw.startsWith('DOM')) nacionalidad = 'dominicano';

      // CG2 — Cargo confiable: TECNICO primero, luego OCUPACION, vía mapa resolutor
      // (alias curados + catálogo + diccionario base). `cargo_origen` = texto que se
      // intentó resolver (para aprender un alias si el usuario lo corrige a mano).
      let cargoId = this.resolverCargo(tecRaw);
      let origen = tecRaw;
      if (!cargoId) { cargoId = this.resolverCargo(ocupRaw); if (cargoId) origen = ocupRaw; }
      if (!origen) origen = ocupRaw || tecRaw;

      // CG2 — vencimiento del permiso de trabajo (parseado de OBSERVACION).
      const permiso = parsePermiso(obs);

      // Tipo de documento: cédula DR vs pasaporte/otro.
      const tipoDoc = doc && CEDULA_RE.test(doc) ? 'cedula' : doc ? 'pasaporte' : 'ninguno';

      // Estado de la fila.
      let estado: FilaPrev['estado'] = 'ok';
      const motivos: string[] = [];
      if (!cargoId) { estado = 'warning'; motivos.push(`Cargo no reconocido («${origen || '—'}») — elige uno`); }
      if (!doc) { estado = estado === 'ok' ? 'warning' : estado; motivos.push('Sin documento'); }
      if (doc && vistos.has(doc)) { estado = 'error'; motivos.push('Documento repetido en el archivo'); }
      if (doc) vistos.add(doc);

      filas.push({
        nombre: titleCase(nombreRaw),
        documento: doc,
        nacionalidad,
        tipo_documento: tipoDoc,
        cargo_id: cargoId,
        cargo_origen: origen || '—',
        cuadrilla: tecRaw ? titleCase(tecRaw) : null,
        permiso_vencimiento: permiso,
        notas: obs,
        estado,
        motivo: motivos.join(' · '),
        yaExiste: false,
      });
    }

    if (!filas.length) { this.error.set('No se encontraron filas de personal.'); return; }
    this.filas.set(filas);

    // Proponer la obra por coincidencia de nombre.
    const pd = norm(this.proyectoDetectado());
    const match = this.obras().find((o) => norm(o.nombre).includes(pd) || pd.includes(norm(o.nombre)));
    this.obraSeleccionada.set(match?.id ?? null);
    if (match) this.marcarDuplicados(match.id);

    this.paso.set('previsualizar');
  }

  async onObraChange(id: string) {
    this.obraSeleccionada.set(id || null);
    if (id) await this.marcarDuplicados(id);
  }

  /** Marca las filas cuyo documento ya existe en la obra elegida (dedupe). */
  private async marcarDuplicados(obraId: string) {
    try {
      const existentes = await this.svc.listar(obraId);
      const docs = new Set(existentes.map((p) => (p.documento_numero ?? '').trim()).filter(Boolean));
      this.filas.update((fs) => fs.map((f) => ({ ...f, yaExiste: !!f.documento && docs.has(f.documento) })));
    } catch { /* no bloquea */ }
  }

  /** Aplica un cargo a una fila, limpia el aviso y aprende el alias si era desconocido. */
  private aplicarCargo(f: FilaPrev, cargoId: string | null): FilaPrev {
    const nf = { ...f, cargo_id: cargoId };
    if (nf.cargo_id && nf.motivo.includes('Cargo no reconocido')) {
      nf.motivo = nf.motivo.split(' · ').filter((m) => !m.includes('Cargo no reconocido')).join(' · ');
      if (nf.estado === 'warning' && !nf.motivo && !!nf.documento) nf.estado = 'ok';
    }
    return nf;
  }

  setCargo(index: number, cargoId: string) {
    const id = cargoId || null;
    const row = this.filas()[index];
    this.filas.update((fs) => fs.map((f, i) => (i === index ? this.aplicarCargo(f, id) : f)));
    // CG2 — aprende el alias: el texto crudo que no resolvía ahora tiene un cargo.
    if (id && row) this.aprenderAlias(row.cargo_origen, id);
  }

  /** CG2 — "Aplicar a los N «TEXTO»": propaga el cargo elegido a todas las filas
   *  con el mismo texto de origen (y aprende el alias una sola vez). */
  aplicarATodosIguales(index: number) {
    const row = this.filas()[index];
    if (!row?.cargo_id || row.cargo_origen === '—') return;
    const origen = row.cargo_origen;
    const id = row.cargo_id;
    const n = this.igualesCount(index);
    this.filas.update((fs) => fs.map((f) => (f.cargo_origen === origen ? this.aplicarCargo(f, id) : f)));
    this.aprenderAlias(origen, id);
    this.toast.success('Aplicado', `${n} filas con «${origen}» quedaron como ${this.cargoNombre(id)}.`);
  }

  /** Nº de otras filas con el mismo texto de origen que la fila dada (para el botón). */
  igualesCount(index: number): number {
    const origen = this.filas()[index]?.cargo_origen;
    if (!origen || origen === '—') return 0;
    return this.filas().filter((f, i) => i !== index && f.cargo_origen === origen).length;
  }

  /** CG2 — registra el alias en el servidor (una vez por texto) y lo refleja localmente. */
  private aprenderAlias(origen: string, cargoId: string) {
    const key = norm(origen);
    if (!key || origen === '—' || this.aprendidos.has(key)) return;
    // Ya resuelve a ESE cargo sin ayuda → no hace falta aprenderlo.
    if (this.resolverMap().get(key) === cargoId) return;
    this.aprendidos.add(key);
    this.svc.registrarCargoAlias(origen, cargoId)
      .then(() => this.aliasList.update((xs) => [
        ...xs.filter((a) => norm(a.alias_normalizado) !== key),
        { id: crypto.randomUUID(), alias_normalizado: origen, cargo_id: cargoId, cargo_codigo: null, cargo_nombre: this.cargoNombre(cargoId), created_at: new Date().toISOString() },
      ]))
      .catch(() => this.aprendidos.delete(key)); // reintentable si falló
  }

  cargoNombre(id: string | null): string {
    return id ? (this.cargoById().get(id)?.nombre ?? '—') : '—';
  }

  /** CG2 — cargo elegido para un documento (para pintarlo en el diff; el preview
   *  RPC no devuelve el cargo, así que lo tomamos de la fila importada). */
  cargoDeDocumento(doc: string | null): string {
    if (!doc) return '—';
    const f = this.filas().find((x) => x.documento === doc);
    return f ? this.cargoNombre(f.cargo_id) : '—';
  }

  /** CG2 — estado del permiso de trabajo frente a hoy (para el chip). */
  permisoEstado(iso: string | null): 'vigente' | 'vencido' | null {
    if (!iso) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const venc = new Date(iso + 'T00:00:00');
    if (isNaN(venc.getTime())) return null;
    return venc.getTime() >= hoy.getTime() ? 'vigente' : 'vencido';
  }

  /** Filas importables (sin error) → contrato del RPC. */
  private buildRows(): ImportPersonalRow[] {
    return this.filas().filter((f) => f.estado !== 'error').map((f) => ({
      nombre: f.nombre,
      apellido: null,
      nacionalidad: f.nacionalidad,
      tipo_documento: f.tipo_documento,
      documento_numero: f.documento,
      cargo_id: f.cargo_id,
      cargo_texto: f.cargo_origen && f.cargo_origen !== '—' ? f.cargo_origen : null, // CG2 — el servidor resuelve/aprende si cargo_id es null
      cuadrilla: f.cuadrilla,
      permiso_vencimiento: f.permiso_vencimiento, // CG2
      notas: f.notas,
    }));
  }

  /** CG2 — descarga una plantilla .xlsx con el formato real + los cargos/alias válidos. */
  async descargarPlantilla() {
    try {
      const XLSX = await import('xlsx');
      const aoa: unknown[][] = [
        [null, 'PROYECTO', 'ALPHA'],
        [null, 'UBICACIÓN', 'Santo Domingo'],
        [null, 'ENC. OBRA', 'Nombre del encargado de obra'],
        [],
        ['NOMBRE', 'OCUPACION', '# DE DOCUMENTO', 'NACIONALIDAD', 'TECNICO', 'OBSERVACION'],
        ['Juan Pérez', 'INGENIERO', '001-0000000-1', 'DOMINICANO', 'INGENIERO', ''],
        ['Pierre Louis', 'OBRERO', 'ID-1234567', 'HTI', 'AYUDANTE', 'Permiso vigente hasta el 11/03/2027'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 40 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'LISTADO');

      // Hoja 2 — cargos válidos del catálogo + alias conocidos (guía para quien llena).
      const cat: unknown[][] = [['Código', 'Cargo']];
      for (const c of this.cargos()) cat.push([c.codigo, c.nombre]);
      cat.push([], ['Texto aceptado (alias)', 'Se mapea a']);
      for (const a of this.aliasList()) cat.push([a.alias_normalizado, a.cargo_nombre ?? this.cargoNombre(a.cargo_id)]);
      const ws2 = XLSX.utils.aoa_to_sheet(cat);
      ws2['!cols'] = [{ wch: 26 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Cargos válidos');

      XLSX.writeFile(wb, 'plantilla-personal-obra.xlsx');
    } catch (e) {
      this.toast.error('No se pudo generar la plantilla', e instanceof Error ? e.message : undefined);
    }
  }

  /** AV4 — paso 1: calcula el diff contra el estado actual y muestra altas/actualizaciones/bajas. */
  async verDiff() {
    const obraId = this.obraSeleccionada();
    if (!obraId) { this.toast.warning('Elige la obra', 'Confirma a qué obra se importa el personal.'); return; }
    const importables = this.filas().filter((f) => f.estado !== 'error');
    if (!importables.length) { this.toast.warning('Nada que importar', 'Todas las filas tienen error.'); return; }
    this.procesando.set(true);
    this.error.set('');
    try {
      const pv = await this.svc.importPreview(obraId, this.buildRows());
      this.preview.set(pv);
      this.bajasChecked.set(new Set()); // las bajas se señalan; RRHH marca las que confirma
      this.paso.set('diff');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo calcular el diff.');
    } finally {
      this.procesando.set(false);
    }
  }

  toggleBaja(id: string) {
    this.bajasChecked.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  esBaja(id: string): boolean {
    return this.bajasChecked().has(id);
  }

  volverAPrevisualizar() {
    this.paso.set('previsualizar');
  }

  /** AV4 — paso 2: importa como ciclo (cabecera de listado + upsert + bajas confirmadas). */
  async confirmarImport() {
    const obraId = this.obraSeleccionada();
    if (!obraId) return;
    this.procesando.set(true);
    this.error.set('');
    const lote = crypto.randomUUID();
    try {
      const res = await this.svc.importarListado(
        obraId, this.buildRows(), lote,
        { enc_obra: this.encObra() || null, archivo: this.archivoNombre() || null },
        Array.from(this.bajasChecked()),
      );
      this.resultado.set(res);
      this.ultimoLote.set(lote);
      this.paso.set('resultado');
      this.toast.success('Import completado', `${res.creados} altas, ${res.actualizados} actualizados, ${res.bajas ?? 0} bajas.`);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo importar.');
    } finally {
      this.procesando.set(false);
    }
  }

  async deshacer() {
    const lote = this.ultimoLote();
    if (!lote || this.procesando()) return;
    if (!confirm('¿Deshacer este lote? Se eliminarán las personas creadas en esta importación (las actualizaciones no se revierten).')) return;
    this.procesando.set(true);
    try {
      const n = await this.svc.deshacerLote(lote);
      this.toast.success('Lote deshecho', `Se eliminaron ${n} registros.`);
      this.ultimoLote.set(null);
    } catch (e) {
      this.toast.error('No se pudo deshacer', e instanceof Error ? e.message : undefined);
    } finally {
      this.procesando.set(false);
    }
  }

  descargarErrores() {
    const res = this.resultado();
    if (!res?.errores?.length) return;
    exportarExcel('errores-import-personal', res.errores.map((e) => ({
      Fila: e.fila, Documento: e.documento ?? '', Error: e.msg,
    })), 'Errores');
  }

  reiniciar() {
    this.paso.set('subir');
    this.filas.set([]);
    this.resultado.set(null);
    this.preview.set(null);
    this.bajasChecked.set(new Set());
    this.error.set('');
    this.proyectoDetectado.set('');
  }
}
