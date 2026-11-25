import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonalObraService, ImportPersonalRow, ImportPersonalResultado, ImportPreview, CargoAlias } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { Cargo } from '../../../../shared/models/personal-obra.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { exportarExcel } from '../../../../shared/utils/exportar-excel.util';
import { Icon } from '../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { detectarObra, norm, resolverCargoTexto, valorDeEtiqueta } from './personal-import.util';
import { PersonalImportFotos, FotoPlan } from './personal-import-fotos';
import { FotoSubida, ImagenLote, ItemSubida, PersonalImportFotosService } from './personal-import-fotos.service';
import { FilaFoto, vincularFilasConPersonal } from './personal-import-fotos.util';

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
  filaExcel: number | null; // EA2 — fila (0-based) de la hoja: anclaje de imágenes incrustadas
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
  // DX9 — OBRERO CSD / AYUDANTE CSD ya NO se aplastan en AYU: tienen cargo propio (sql/2026-11-23-dx9-cargos-ocupaciones.sql).
  AYUDANTE: 'AYU', PLOMERO: 'PLOM', ELECTRICISTA: 'ELEC',
  PINTOR: 'PINT', SOLDADOR: 'SOLD', VIGILANTE: 'VIG',
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
  imports: [RouterLink, Icon, TranslatePipe, PersonalImportFotos],
  templateUrl: './personal-import.html',
  styleUrl: './personal-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalImport implements OnInit {
  private svc = inject(PersonalObraService);
  private proyectosSvc = inject(ProyectosService);
  private toast = inject(ToastService);
  private fotosSvc = inject(PersonalImportFotosService);
  protected i18n = inject(I18nService);

  paso = signal<'subir' | 'previsualizar' | 'fotos' | 'diff' | 'resultado'>('subir');
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
  /** DX9 — avisos EN VOZ ALTA (antes: try/catch mudo y obra «adivinada»). */
  avisoObra = signal('');
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

  // EA2 — fotos por lote (paso «Fotos»): nada se sube hasta confirmar el import.
  fotosIniciadas = signal(false);
  imagenesXlsx = signal<ImagenLote[]>([]);
  planFotos = signal<FotoPlan[]>([]);
  avisoFotos = signal('');
  subiendoFotos = signal(false);
  fotosSubidas = signal<FotoSubida[]>([]);
  resultadoFotos = signal<{ subidas: number; omitidas: number; fallidas: number; sinPersona: number } | null>(null);
  /** Filas importables (sin error) para emparejar fotos; `indice` = posición en `filas()` (estable). */
  filasFoto = computed<FilaFoto[]>(() =>
    this.filas()
      .map((f, indice) => ({ indice, nombre: f.nombre, documento: f.documento, filaExcel: f.filaExcel, error: f.estado === 'error' }))
      .filter((f) => !f.error)
      .map(({ indice, nombre, documento, filaExcel }) => ({ indice, nombre, documento, filaExcel })));

  okCount = computed(() => this.filas().filter((f) => f.estado !== 'error').length);
  errCount = computed(() => this.filas().filter((f) => f.estado === 'error').length);
  dupCount = computed(() => this.filas().filter((f) => f.yaExiste).length);

  async ngOnInit() {
    // DX9 — cada catálogo carga por separado: antes un Promise.all dejaba AMBOS vacíos si uno fallaba
    // (todo «Sin cargo», sin obra) y el error se perdía. Ahora un catálogo vacío/roto avisa en rojo.
    const [rc, ro] = await Promise.allSettled([this.svc.getCargos(), this.proyectosSvc.getDirectorio('personal')]);
    const fallos: string[] = [];
    if (rc.status === 'fulfilled' && rc.value.length) this.cargos.set(rc.value);
    else fallos.push('cargos');
    if (ro.status === 'fulfilled' && ro.value.length) this.obras.set(ro.value);
    else fallos.push('obras');
    if (fallos.length) {
      this.error.set(this.i18n.t('No pude leer el catálogo de cargos/obras; avisa a Tecnología.') + ' (' + fallos.join(', ') + ')');
      const motivo = [rc, ro].find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
      if (motivo) console.error('personal-import: catálogos', motivo);
    }
    // CG2 — los alias no bloquean la carga; si fallan, el diccionario base cubre.
    try {
      this.aliasList.set(await this.svc.listarCargoAlias());
    } catch { /* red de seguridad: resolverMap sigue con catálogo + diccionario base */ }
  }

  /** CG2 — resuelve un texto crudo a cargo_id (alias → código → nombre → diccionario). */
  private resolverCargo(raw: unknown): { id: string | null; sugerencia: string | null } {
    const r = resolverCargoTexto(raw, this.resolverMap(), this.cargos());
    return { id: r.id, sugerencia: r.sugerencia?.nombre ?? null };
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
      // EA2 — blankrows:true conserva la numeración real de la hoja (para anclar imágenes incrustadas a su fila).
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
      const offset = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
      this.parsear(rows, offset);
      // EA2 — imágenes incrustadas en el .xlsx (se tratan igual que las subidas; si falla, el import sigue sin ellas).
      this.imagenesXlsx.set((await this.fotosSvc.desdeXlsx(buf)).imagenes);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }

  private parsear(rows: unknown[][], offset = 0) {
    // DX9 — encabezado de obra: PROYECTO / OBRA / UBICACIÓN / ENC. en CUALQUIER columna de las 20 primeras filas.
    this.proyectoDetectado.set(valorDeEtiqueta(rows, ['PROYECTO', 'OBRA']));
    this.ubicacionDetectada.set(valorDeEtiqueta(rows, ['UBICACION']));
    this.encObra.set(valorDeEtiqueta(rows, ['ENC'], 20, true));

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
      const rTec = this.resolverCargo(tecRaw);
      let cargoId = rTec.id;
      let origen = tecRaw;
      let sugerencia = rTec.sugerencia;
      if (!cargoId) {
        const rOc = this.resolverCargo(ocupRaw);
        cargoId = rOc.id;
        if (cargoId) origen = ocupRaw;
        else sugerencia = rOc.sugerencia ?? sugerencia;
      }
      // Sin resolver el origen más útil para el aviso/alias es la OCUPACION (el TECNICO suele ser la cuadrilla).
      if (!cargoId && ocupRaw) origen = ocupRaw;
      if (!origen) origen = ocupRaw || tecRaw;

      // CG2 — vencimiento del permiso de trabajo (parseado de OBSERVACION).
      const permiso = parsePermiso(obs);

      // Tipo de documento: cédula DR vs pasaporte/otro.
      const tipoDoc = doc && CEDULA_RE.test(doc) ? 'cedula' : doc ? 'pasaporte' : 'ninguno';

      // Estado de la fila.
      let estado: FilaPrev['estado'] = 'ok';
      const motivos: string[] = [];
      if (!cargoId) { estado = 'warning'; motivos.push(`Cargo no reconocido («${origen || '—'}»)${sugerencia ? ` — ¿${sugerencia}?` : ''} — elige uno`); }
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
        filaExcel: i + offset,
      });
    }

    if (!filas.length) { this.error.set('No se encontraron filas de personal.'); return; }
    this.filas.set(filas);

    // Proponer la obra por coincidencia de nombre.
    // DX9 — igualdad normalizada y luego contención SOLO si es única; si no, vacío + aviso (nunca «la primera obra»).
    const { obra: match, motivo } = detectarObra(this.proyectoDetectado(), this.obras());
    this.obraSeleccionada.set(match?.id ?? null);
    this.avisoObra.set(match ? '' : this.i18n.t('No pude detectar la obra: elígela') + (motivo === 'ambigua' ? ' (' + this.i18n.t('hay varias parecidas') + ')' : ''));
    if (match) this.marcarDuplicados(match.id);

    this.paso.set('previsualizar');
  }

  async onObraChange(id: string) {
    this.obraSeleccionada.set(id || null);
    if (id) { this.avisoObra.set(''); await this.marcarDuplicados(id); }
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
    this.toast.success(this.i18n.t('Aplicado'), `${n} filas con «${origen}» quedaron como ${this.cargoNombre(id)}.`);
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
      this.toast.error(this.i18n.t('No se pudo generar la plantilla'), e instanceof Error ? e.message : undefined);
    }
  }

  /** EA2 — «Continuar» de la vista previa: paso de fotos (si hay consentimiento de IA) o directo al diff. */
  async siguienteDePrevia() {
    if (!this.obraSeleccionada()) { this.toast.warning(this.i18n.t('Elige la obra'), 'Confirma a qué obra se importa el personal.'); return; }
    if (!(await this.fotosSvc.tieneConsentimientoIa())) {
      // Sin consentimiento de IA el paso de fotos se omite con aviso; el import sin fotos sigue igual.
      this.planFotos.set([]);
      this.avisoFotos.set(this.i18n.t('Se omitió el paso de fotos: para que la IA lea las cédulas, actívala en Perfil › Privacidad. Las fotos se pueden tomar luego en obra con la app.'));
      await this.verDiff();
      return;
    }
    this.avisoFotos.set('');
    this.fotosIniciadas.set(true);
    this.paso.set('fotos');
  }

  onPlanFotos(plan: FotoPlan[]) { this.planFotos.set(plan); }
  volverDeFotos() { this.paso.set('previsualizar'); }

  /** AV4 — paso 1: calcula el diff contra el estado actual y muestra altas/actualizaciones/bajas. */
  async verDiff() {
    const obraId = this.obraSeleccionada();
    if (!obraId) { this.toast.warning(this.i18n.t('Elige la obra'), 'Confirma a qué obra se importa el personal.'); return; }
    const importables = this.filas().filter((f) => f.estado !== 'error');
    if (!importables.length) { this.toast.warning(this.i18n.t('Nada que importar'), 'Todas las filas tienen error.'); return; }
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
      this.toast.success(this.i18n.t('Import completado'), `${res.creados} altas, ${res.actualizados} actualizados, ${res.bajas ?? 0} bajas.`);
      await this.subirFotosDelLote(obraId, lote);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo importar.');
    } finally {
      this.procesando.set(false);
    }
  }

  /** EA2 — tras confirmar: guarda cada foto en el expediente de SU persona (bucket privado) y las deja dentro del lote para «Deshacer». */
  private async subirFotosDelLote(obraId: string, lote: string) {
    const plan = this.planFotos();
    if (!plan.length) return;
    this.subiendoFotos.set(true);
    try {
      const personal = await this.svc.listar(obraId);
      const porFila = vincularFilasConPersonal(this.filasFoto(), personal, lote);
      const porId = new Map(personal.map((p) => [p.id, p] as const));
      let sinPersona = 0;
      const items: ItemSubida[] = [];
      for (const f of plan) {
        const p = porId.get(porFila.get(f.filaIndice) ?? '');
        if (!p) { sinPersona++; continue; }
        items.push({ fotoId: f.fotoId, personal: p, tipo: f.tipo, file: f.file });
      }
      const r = await this.fotosSvc.subirAlExpediente(items);
      this.fotosSubidas.set(r.subidas);
      this.resultadoFotos.set({ subidas: r.subidas.length, omitidas: r.omitidas.length, fallidas: r.fallidas.length, sinPersona });
      this.toast.success(this.i18n.t('Fotos guardadas'), this.i18n.t('{n} foto(s) asignadas al expediente.', { n: r.subidas.length }));
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudieron guardar las fotos'), e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendoFotos.set(false);
    }
  }

  async deshacer() {
    const lote = this.ultimoLote();
    if (!lote || this.procesando()) return;
    if (!confirm(this.i18n.t('¿Deshacer este lote? Se eliminarán las personas creadas en esta importación (las actualizaciones no se revierten).'))) return;
    this.procesando.set(true);
    try {
      // EA2 — primero las fotos que subió este import (bucket + filas), luego las personas creadas.
      try { await this.fotosSvc.quitarSubidas(this.fotosSubidas()); this.fotosSubidas.set([]); this.resultadoFotos.set(null); }
      catch (e) { this.toast.warning(this.i18n.t('No se pudieron quitar algunas fotos'), e instanceof Error ? e.message : undefined); }
      const n = await this.svc.deshacerLote(lote);
      this.toast.success(this.i18n.t('Lote deshecho'), `Se eliminaron ${n} registros.`);
      this.ultimoLote.set(null);
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo deshacer'), e instanceof Error ? e.message : undefined);
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
    // EA2
    this.fotosIniciadas.set(false);
    this.imagenesXlsx.set([]);
    this.planFotos.set([]);
    this.avisoFotos.set('');
    this.fotosSubidas.set([]);
    this.resultadoFotos.set(null);
  }
}
