import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonalObraService, ImportPersonalRow, ImportPersonalResultado, ImportPreview } from '../../../../shared/services/personal-obra.service';
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
  cargo_origen: string;     // texto crudo del Excel (OCUPACION / TECNICO)
  cuadrilla: string | null; // AV4 — eje TECNICO (cuadrilla) crudo, título
  notas: string | null;
  estado: 'ok' | 'warning' | 'error';
  motivo: string;           // por qué warning/error
  yaExiste: boolean;        // dedupe contra la obra elegida
}

// AT5 — normaliza texto sucio (mayúsculas, acentos, espacios al final).
function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Diccionario cuadrilla/ocupación → código de cargo AR1.
const CARGO_DICT: Record<string, string> = {
  INGENIERO: 'ING', MAESTRO: 'MAE', CAPATAZ: 'CAP', 'CAPATAZ CSD': 'CAP',
  VARILLERO: 'VAR', FERRALLERO: 'FERR', CARPINTERO: 'CARP', ALBANIL: 'ALB',
  AYUDANTE: 'AYU', 'AYUDANTE CSD': 'AYU', PLOMERO: 'PLOM', ELECTRICISTA: 'ELEC',
  PINTOR: 'PINT', SOLDADOR: 'SOLD', VIGILANTE: 'VIG', OBRERO: 'AYU',
};

// Formato de cédula dominicana 000-0000000-0.
const CEDULA_RE = /^\d{3}-?\d{7}-?\d$/;

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
  obras = signal<ObraRef[]>([]);
  cargoById = computed(() => new Map(this.cargos().map((c) => [c.id, c] as const)));

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
      const [cargos, obras] = await Promise.all([this.svc.getCargos(), this.proyectosSvc.getDirectorio()]);
      this.cargos.set(cargos);
      this.obras.set(obras);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar catálogos.');
    }
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

    const codigoToId = new Map(this.cargos().map((c) => [c.codigo, c.id] as const));
    const filas: FilaPrev[] = [];
    const vistos = new Set<string>();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const nombreRaw = String(r[iNombre] ?? '').trim();
      if (!nombreRaw) continue;               // fila vacía
      if (norm(nombreRaw) === 'NOMBRE') continue; // re-header

      const ocup = norm(r[iOcup]);
      const tec = norm(r[iTec]);
      const doc = String(r[iDoc] ?? '').trim() || null;
      const nacRaw = norm(r[iNac]);
      const obs = String(r[iObs] ?? '').trim() || null;

      // Nacionalidad.
      let nacionalidad = 'otro';
      if (nacRaw.startsWith('DOM')) nacionalidad = 'dominicano';
      else if (nacRaw.startsWith('HT') || nacRaw.startsWith('HAIT')) nacionalidad = 'haitiano';

      // Cargo: cuadrilla (TECNICO) primero, luego nivel (OCUPACION).
      const cargoCod = CARGO_DICT[tec] ?? CARGO_DICT[ocup] ?? null;
      const cargoId = cargoCod ? (codigoToId.get(cargoCod) ?? null) : null;

      // Tipo de documento: cédula DR vs pasaporte/otro.
      const tipoDoc = doc && CEDULA_RE.test(doc) ? 'cedula' : doc ? 'pasaporte' : 'ninguno';

      // Estado de la fila.
      let estado: FilaPrev['estado'] = 'ok';
      const motivos: string[] = [];
      if (!cargoId) { estado = 'warning'; motivos.push(`Cargo no reconocido («${(r[iTec] ?? r[iOcup] ?? '—')}») — elige uno`); }
      if (!doc) { estado = estado === 'ok' ? 'warning' : estado; motivos.push('Sin documento'); }
      if (doc && vistos.has(doc)) { estado = 'error'; motivos.push('Documento repetido en el archivo'); }
      if (doc) vistos.add(doc);

      filas.push({
        nombre: titleCase(nombreRaw),
        documento: doc,
        nacionalidad,
        tipo_documento: tipoDoc,
        cargo_id: cargoId,
        cargo_origen: String(r[iTec] ?? r[iOcup] ?? '').trim() || '—',
        cuadrilla: (r[iTec] != null && String(r[iTec]).trim()) ? titleCase(String(r[iTec])) : null,
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

  setCargo(index: number, cargoId: string) {
    this.filas.update((fs) => fs.map((f, i) => {
      if (i !== index) return f;
      const nf = { ...f, cargo_id: cargoId || null };
      // Recalcula estado si ya no falta el cargo.
      if (nf.cargo_id && nf.estado === 'warning' && nf.motivo.includes('Cargo no reconocido')) {
        nf.motivo = nf.motivo.split(' · ').filter((m) => !m.includes('Cargo no reconocido')).join(' · ');
        if (!nf.motivo && !!nf.documento) nf.estado = 'ok';
      }
      return nf;
    }));
  }

  cargoNombre(id: string | null): string {
    return id ? (this.cargoById().get(id)?.nombre ?? '—') : '—';
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
      cuadrilla: f.cuadrilla,
      notas: f.notas,
    }));
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
