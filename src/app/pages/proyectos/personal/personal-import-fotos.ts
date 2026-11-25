import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { Icon } from '../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { ErrorLectura, ImagenLote, PersonalImportFotosService } from './personal-import-fotos.service';
import {
  AsignacionFoto, CONCURRENCIA_LECTURA, FilaFoto, FotoEntrada, FotoTipoDestino, LecturaCedula, MAX_IMAGENES_LOTE,
  MotivoSinAsignar, UMBRAL_CONFIANZA_DEFECTO, emparejarFotos, estimarCosto, procesarConConcurrencia, resumenAsignaciones,
} from './personal-import-fotos.util';

/** Una foto lista para subir al expediente cuando se confirme el import. */
export interface FotoPlan { fotoId: string; filaIndice: number; tipo: FotoTipoDestino; file: File }

interface LecturaFoto { lectura: LecturaCedula | null; error: string | null }

const MOTIVOS: Record<MotivoSinAsignar, string> = {
  error: 'No se pudo leer',
  ilegible: 'Ilegible',
  baja_confianza: 'Lectura poco segura',
  no_en_excel: 'No está en el Excel',
  ambiguo: 'Varias personas coinciden',
  otra: 'No es un documento',
};
const TIPOS_LABEL: Record<FotoTipoDestino, string> = {
  documento: 'Documento',
  persona_carnet_cedula: 'Persona con cédula',
  persona: 'Foto de la persona',
};

/**
 * EA2 — paso «Fotos» del import de personal de obra: sube imágenes/ZIP (y usa las incrustadas en el .xlsx),
 * las lee con IA UNA por una y las empareja con las filas del Excel de forma determinista. NADA se sube al
 * expediente aquí: emite un `plan` que el padre ejecuta tras confirmar el import.
 */
@Component({
  selector: 'app-personal-import-fotos',
  imports: [FileUpload, Icon, TranslatePipe],
  templateUrl: './personal-import-fotos.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalImportFotos implements OnDestroy {
  private svc = inject(PersonalImportFotosService);
  protected i18n = inject(I18nService);

  /** Filas importables del Excel (sin error). */
  filas = input.required<FilaFoto[]>();
  /** Imágenes incrustadas en el .xlsx, ya extraídas por el padre. */
  imagenesXlsx = input<ImagenLote[]>([]);

  planChange = output<FotoPlan[]>();
  continuar = output<void>();
  volver = output<void>();

  protected readonly maxImagenes = MAX_IMAGENES_LOTE;
  protected readonly MOTIVOS = MOTIVOS;
  protected readonly TIPOS_LABEL = TIPOS_LABEL;

  private propias = signal<ImagenLote[]>([]);
  omitidas = signal<{ nombre: string; motivo: string }[]>([]);
  identicas = signal(0);
  extrayendo = signal(false);
  estado = signal<'preparar' | 'procesando' | 'listo'>('preparar');
  hechos = signal(0);
  aviso = signal('');
  private lecturas = signal<Map<string, LecturaFoto>>(new Map());
  private pendientes = signal<Set<string>>(new Set()); // sin procesar (parada por límite/consentimiento)
  private umbral = signal(UMBRAL_CONFIANZA_DEFECTO);
  private manual = signal<Map<string, number>>(new Map());
  private preferidas = signal<Set<string>>(new Set());
  private detener = false;
  private urls = new Map<File, string>();

  /** Todas las imágenes: incrustadas (si no se repiten) + las subidas. */
  imagenes = computed(() => {
    const vistas = new Set<string>();
    const out: ImagenLote[] = [];
    for (const im of [...this.imagenesXlsx(), ...this.propias()]) {
      if (vistas.has(im.hash)) continue;
      vistas.add(im.hash);
      out.push(im);
    }
    return out;
  });
  /** Para el contador del uploader. */
  archivosParaContar = computed(() => this.imagenes().map((i) => i.file));
  costo = computed(() => estimarCosto(this.porProcesar().length));
  progreso = computed(() => (this.imagenes().length ? Math.round((this.hechos() / this.imagenes().length) * 100) : 0));

  private entradas = computed<FotoEntrada[]>(() => {
    const lect = this.lecturas();
    return this.imagenes().filter((im) => lect.has(im.id)).map((im) => {
      const l = lect.get(im.id) as LecturaFoto;
      return { id: im.id, origen: im.origen, nombreArchivo: im.nombreArchivo, ancla: im.ancla, lectura: l.lectura, error: l.error };
    });
  });

  asignaciones = computed<AsignacionFoto[]>(() =>
    emparejarFotos(this.filas(), this.entradas(), this.umbral(), { manual: this.manual(), preferidas: this.preferidas() }));
  resumen = computed(() => resumenAsignaciones(this.asignaciones()));

  private imagenPorId = computed(() => new Map(this.imagenes().map((i) => [i.id, i] as const)));
  private filaPorIndice = computed(() => new Map(this.filas().map((f) => [f.indice, f] as const)));

  /** Por fila: sus fotos (principal primero, duplicadas después). */
  porFila = computed(() => {
    const m = new Map<number, AsignacionFoto[]>();
    for (const a of this.asignaciones()) {
      if (a.filaIndice == null) continue;
      m.set(a.filaIndice, [...(m.get(a.filaIndice) ?? []), a]);
    }
    for (const g of m.values()) g.sort((x, y) => Number(x.duplicada) - Number(y.duplicada));
    return m;
  });
  sinAsignar = computed(() => this.asignaciones().filter((a) => a.filaIndice == null));
  sinProcesar = computed(() => this.imagenes().filter((im) => this.pendientes().has(im.id)));

  /** Lo que se subirá al confirmar: la foto principal de cada cupo (las duplicadas y las sin asignar NO). */
  plan = computed<FotoPlan[]>(() => {
    const out: FotoPlan[] = [];
    for (const a of this.asignaciones()) {
      if (a.filaIndice == null || a.duplicada || !a.tipoDestino) continue;
      const im = this.imagenPorId().get(a.fotoId);
      if (im) out.push({ fotoId: a.fotoId, filaIndice: a.filaIndice, tipo: a.tipoDestino, file: im.file });
    }
    return out;
  });

  constructor() {
    // El padre guarda el plan para ejecutarlo tras confirmar el import (se re-emite ante CUALQUIER cambio).
    effect(() => this.planChange.emit(this.plan()));
  }

  ngOnDestroy() {
    this.detener = true;
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  // ── Entrada de archivos ─────────────────────────────────────────────────
  async onAgregar(files: File[]) {
    if (this.estado() === 'procesando') return;
    this.extrayendo.set(true);
    try {
      const r = await this.svc.desdeArchivos(files);
      const hashes = new Set(this.imagenes().map((i) => i.hash));
      const nuevas: ImagenLote[] = [];
      let repetidas = 0;
      for (const im of r.imagenes) {
        if (hashes.has(im.hash)) { repetidas++; continue; }
        if (this.imagenes().length + nuevas.length >= MAX_IMAGENES_LOTE) { this.omitidas.update((o) => [...o, { nombre: im.nombreArchivo, motivo: 'Se superó el máximo de imágenes por lote' }]); continue; }
        hashes.add(im.hash);
        nuevas.push(im);
      }
      this.propias.update((p) => [...p, ...nuevas]);
      this.omitidas.update((o) => [...o, ...r.omitidas]);
      this.identicas.update((n) => n + repetidas);
      if (this.estado() === 'listo') this.estado.set('preparar'); // hay imágenes nuevas por procesar
    } finally {
      this.extrayendo.set(false);
    }
  }

  quitarSinProcesar(id: string) {
    this.propias.update((p) => p.filter((i) => i.id !== id));
  }

  // ── Procesamiento (lectura con IA) ───────────────────────────────────────
  /** Solo las imágenes que aún no tienen lectura (permite reintentar o agregar más sin repetir costo). */
  porProcesar = computed(() => this.imagenes().filter((im) => !this.lecturas().has(im.id)));

  async procesar() {
    const lista = this.porProcesar();
    if (!lista.length || this.estado() === 'procesando') return;
    this.estado.set('procesando');
    this.detener = false;
    this.hechos.set(this.lecturas().size);
    this.pendientes.set(new Set());
    const parada = { msg: null as string | null };
    const res = await procesarConConcurrencia(lista, CONCURRENCIA_LECTURA, async (im) => {
      try {
        const r = await this.svc.leerCedula(im.file);
        this.umbral.set(r.confianzaMin);
        this.guardarLectura(im.id, { lectura: r.lectura, error: null });
      } catch (e) {
        const err = e instanceof ErrorLectura ? e : new ErrorLectura(e instanceof Error ? e.message : 'No se pudo leer la imagen.');
        if (err.fatal) { parada.msg = err.message; this.detener = true; throw err; }
        this.guardarLectura(im.id, { lectura: null, error: err.message });
      }
    }, { parar: () => this.detener, onProgreso: () => this.hechos.update((n) => n + 1) });
    // Las que quedaron sin leer por una parada (límite / consentimiento) se marcan pendientes; el resto del lote NO se pierde.
    const pend = new Set<string>();
    res.forEach((r, i) => { if ('omitido' in r || ('error' in r && parada.msg)) { if (!this.lecturas().has(lista[i].id)) pend.add(lista[i].id); } });
    this.pendientes.set(pend);
    this.aviso.set(parada.msg ?? '');
    this.estado.set('listo');
  }

  private guardarLectura(id: string, l: LecturaFoto) {
    this.lecturas.update((m) => new Map(m).set(id, l));
  }

  /** Reintenta solo las que fallaron (error de lectura), sin repetir las ya leídas. */
  async reintentarFallidas() {
    this.lecturas.update((m) => {
      const n = new Map(m);
      for (const [k, v] of n) if (v.error) n.delete(k);
      return n;
    });
    await this.procesar();
  }
  fallidas = computed(() => [...this.lecturas().values()].filter((l) => l.error).length);

  // ── Corrección manual ───────────────────────────────────────────────────
  asignarManual(fotoId: string, valor: string) {
    const n = valor === '' ? null : Number(valor);
    this.manual.update((m) => {
      const c = new Map(m);
      if (n == null || Number.isNaN(n)) c.delete(fotoId); else c.set(fotoId, n);
      return c;
    });
  }
  usarEsta(fotoId: string) {
    this.preferidas.update((s) => new Set(s).add(fotoId));
  }
  quitarAsignacion(fotoId: string) {
    this.manual.update((m) => { const c = new Map(m); c.delete(fotoId); return c; });
  }

  // ── Presentación ────────────────────────────────────────────────────────
  url(im: ImagenLote | undefined): string | null {
    if (!im) return null;
    let u = this.urls.get(im.file);
    if (!u) { u = URL.createObjectURL(im.file); this.urls.set(im.file, u); }
    return u;
  }
  imagen(id: string): ImagenLote | undefined { return this.imagenPorId().get(id); }
  fila(i: number): FilaFoto | undefined { return this.filaPorIndice().get(i); }
  etiquetaFila(i: number): string { const f = this.fila(i); return f ? f.nombre + (f.documento ? ` · ${f.documento}` : '') : '—'; }
  motivo(a: AsignacionFoto): string { return a.motivo ? this.i18n.t(MOTIVOS[a.motivo]) : ''; }
  tipo(t: FotoTipoDestino | null): string { return t ? this.i18n.t(TIPOS_LABEL[t]) : ''; }
  viaTexto(a: AsignacionFoto): string {
    switch (a.via) {
      case 'documento': return this.i18n.t('por documento');
      case 'nombre': return this.i18n.t('por nombre');
      case 'anclaje': return this.i18n.t('por posición en el Excel');
      case 'manual': return this.i18n.t('manual');
      default: return '';
    }
  }
  costoTexto(): string { return this.i18n.t('~{n} imágenes · costo estimado ≈ US$ {usd}', { n: this.costo().imagenes, usd: this.costo().usd.toFixed(2) }); }
}
