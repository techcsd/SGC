import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { VehiculosService } from '../../../../../shared/services/vehiculos.service';
import {
  FlotaDocumentosLectorService,
  PaginaEmparejada,
  FilaAplicar,
  ResultadoAplicar,
  TipoDocumentoFlota,
} from '../../../../../shared/services/flota-documentos-lector.service';
import { Vehiculo } from '../../../../../shared/models/vehiculo.model';
import { UserService } from '../../../../core/services/user.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { pdfAImagenes, dataUrlABlob, renderPaginaPdf } from '../../../../../shared/utils/pdf-a-imagenes.util';
import { displayVehiculoCompleto } from '../../../../../shared/utils/vehiculo-display.util';
import { humanizeError } from '../../../../../shared/utils/friendly-error.util';
import { Icon } from '../../../../../shared/ui/icon/icon';
import { TranslatePipe } from '../../../../../shared/i18n/translate.pipe';
import { AsignarDocumentoPanel, FilaParaAsignar } from './asignar-documento-panel/asignar-documento-panel';

/** DB3 — una fila de la tabla de revisión (página leída + decisión humana). */
interface FilaRevision extends PaginaEmparejada {
  sel: boolean;
  vehiculoElegido: string | null; // decisión final (puede venir del match o del selector)
  thumb: string | null; // PNG dataURL de la página
  resultado?: ResultadoAplicar | null;
  /** DE2/DE-05 — reverso emparejado por posición (pagina = anverso+1); null si no tiene o es huérfano. */
  reversoThumb?: string | null;
  reversoPagina?: number | null;
}

// DE2 — 'reverso' se vuelve aplicable: tras emparejar() por posición (ver
// emparejarReversos()), cualquier fila 'reverso' que SIGA en la tabla es
// huérfana (la emparejada desaparece de la lista) y solo guarda su imagen.
const TIPOS_APLICABLES = new Set<TipoDocumentoFlota>(['seguro', 'matricula', 'marbete_dgii', 'reverso']);

/**
 * DB3 (Ronda DB) — Flota › Vehículos › Cargar documentos: sube el PDF de los
 * marbetes/seguros renovados (o fotos), la IA lee cada página, el sistema
 * empareja por placa/VIN y la persona revisa ANTES de aplicar. Nada se guarda
 * sin revisión por fila (riesgo real: placa leída con un dígito cambiado).
 */
@Component({
  selector: 'app-flota-cargar-documentos',
  templateUrl: './cargar-documentos.html',
  styleUrl: './cargar-documentos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, TranslatePipe, AsignarDocumentoPanel],
})
export class FlotaCargarDocumentos implements OnInit {
  private lector = inject(FlotaDocumentosLectorService);
  private vehiculosService = inject(VehiculosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  paso = signal<'inicio' | 'leyendo' | 'revision' | 'aplicando' | 'resultado'>('inicio');
  error = signal('');
  filas = signal<FilaRevision[]>([]);
  vehiculos = signal<Vehiculo[]>([]);
  /** vehículo preseleccionado (botón «Leer documento» de la ficha). */
  private vehiculoFijo: string | null = null;
  nombreArchivo = signal('');
  resultados = signal<ResultadoAplicar[]>([]);

  // DE1 (Ronda DE) — panel «Asignar…»: índice de la fila abierta + buffer del PDF
  // en memoria (para el visor a demanda, DE-03; null si el lote es de fotos).
  panelAbiertoIndex = signal<number | null>(null);
  private pdfBuffer: ArrayBuffer | null = null;
  panelFila = computed<FilaParaAsignar | null>(() => {
    const i = this.panelAbiertoIndex();
    return i === null ? null : (this.filas()[i] ?? null);
  });
  /** F2§4 — avisa (no bloquea) si el vehículo ya tiene otro doc del MISMO tipo en este lote. */
  vehiculosConDocEnLotePanel = computed<Set<string>>(() => {
    const actual = this.panelFila();
    if (!actual) return new Set();
    return new Set(
      this.filas()
        .filter((f) => f.tipo === actual.tipo && f.vehiculoElegido && f !== actual)
        .map((f) => f.vehiculoElegido as string),
    );
  });
  renderGrandeFn = (pagina: number): Promise<string> => {
    if (!this.pdfBuffer) return Promise.resolve(this.filas().find((f) => f.pagina === pagina)?.thumb ?? '');
    return renderPaginaPdf(this.pdfBuffer.slice(0), pagina, 2);
  };

  /** Aplicar = admin o flota elevada (jefe_flota/logistica); el RPC lo re-valida. */
  puedeAplicar = computed(() =>
    this.userService.hasRole('admin') || this.userService.hasRole('jefe_flota') || this.userService.hasRole('logistica'));

  seleccionadas = computed(() => this.filas().filter((f) => f.sel && f.vehiculoElegido && TIPOS_APLICABLES.has(f.tipo)));
  vehiculosDistintos = computed(() => new Set(this.seleccionadas().map((f) => f.vehiculoElegido)).size);
  resumenOk = computed(() => this.resultados().filter((r) => r.ok).length);

  async ngOnInit() {
    this.vehiculoFijo = this.route.snapshot.queryParamMap.get('vehiculo');
    try {
      this.vehiculos.set((await this.vehiculosService.getAll()).filter((v) => v.activo !== false));
    } catch { /* el selector queda vacío; el match automático sigue sirviendo */ }
  }

  // ── Paso 1: elegir archivo(s) ────────────────────────────────────────────────
  // DB3 — hotfix: la zona invitaba a "soltar" pero no tenía ningún listener de
  // drag&drop (solo el <input type="file"> oculto funcionaba). `dragover` en
  // estado activo para feedback visual; `drop` entrega los archivos al mismo
  // flujo que el selector.
  arrastrando = signal(false);
  onDragOver(ev: DragEvent) { ev.preventDefault(); this.arrastrando.set(true); }
  onDragLeave(ev: DragEvent) { ev.preventDefault(); this.arrastrando.set(false); }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.arrastrando.set(false);
    void this.onArchivos(ev.dataTransfer?.files ?? null);
  }

  async onArchivos(files: FileList | null) {
    if (!files?.length) return;
    const lista = Array.from(files);
    const esPdf = lista[0].type === 'application/pdf';
    if (esPdf && lista.length > 1) {
      this.toast.error('Un solo PDF', 'Sube un PDF (con todas sus páginas) o hasta 20 fotos.');
      return;
    }
    if (!esPdf && lista.some((f) => !f.type.startsWith('image/'))) {
      this.toast.error('Formato no soportado', 'Usa un PDF o fotos JPG/PNG/WEBP.');
      return;
    }
    if (!esPdf && lista.length > 20) {
      this.toast.error('Demasiadas fotos', 'Máximo 20 fotos por lectura.');
      return;
    }
    this.error.set('');
    this.paso.set('leyendo');
    this.nombreArchivo.set(esPdf ? lista[0].name : `${lista.length} foto(s)`);
    try {
      let archivosEdge: { data: string; mime: string }[];
      let thumbs: string[];
      if (esPdf) {
        const buf = await lista[0].arrayBuffer();
        this.pdfBuffer = buf;
        archivosEdge = [{ data: this.aBase64(buf), mime: 'application/pdf' }];
        thumbs = (await pdfAImagenes(buf.slice(0))).map((p) => p.dataUrl);
      } else {
        this.pdfBuffer = null;
        const bufs = await Promise.all(lista.map((f) => f.arrayBuffer()));
        archivosEdge = bufs.map((b, i) => ({ data: this.aBase64(b), mime: lista[i].type }));
        thumbs = await Promise.all(lista.map((f) => this.aDataUrl(f)));
      }
      const { paginas, omitidas } = await this.lector.leer(archivosEdge);
      if (omitidas > 0) {
        this.toast.error('Algunas páginas no se pudieron leer', `${omitidas} página(s) no se leyeron — el servicio tardó demasiado o falló. Revisa el resto y vuelve a intentar con esas páginas si hace falta.`);
      }
      const emparejadas = await this.lector.emparejar(paginas);

      // DE2/DE-05 — el reverso va SIEMPRE en la página inmediatamente después de
      // su anverso en el mismo archivo. Se empareja aquí (el cliente ve el orden
      // real del lote) y desaparece de la tabla; viaja con su anverso.
      const porPagina = new Map(emparejadas.map((p) => [p.pagina, p] as const));
      const reversoPorAnverso = new Map<number, PaginaEmparejada>();
      for (const p of emparejadas) {
        if (p.tipo !== 'reverso') continue;
        const anv = porPagina.get(p.pagina - 1);
        if (anv && anv.tipo !== 'reverso' && anv.tipo !== 'otro') reversoPorAnverso.set(anv.pagina, p);
      }
      const paginasReversoEmparejado = new Set([...reversoPorAnverso.values()].map((r) => r.pagina));

      this.filas.set(
        emparejadas
          .filter((p) => !paginasReversoEmparejado.has(p.pagina))
          .map((p) => {
            const auto = (p.match === 'exacta' || p.match === 'vin') ? (p.vehiculo_id ?? null) : null;
            const elegido = auto ?? (this.vehiculoFijo && p.match === 'sin_vehiculo' && TIPOS_APLICABLES.has(p.tipo) ? this.vehiculoFijo : null);
            const reverso = reversoPorAnverso.get(p.pagina);
            return {
              ...p,
              sel: TIPOS_APLICABLES.has(p.tipo) && !!elegido,
              vehiculoElegido: elegido,
              thumb: thumbs[p.pagina - 1] ?? null,
              reversoThumb: reverso ? (thumbs[reverso.pagina - 1] ?? null) : null,
              reversoPagina: reverso?.pagina ?? null,
            };
          }),
      );
      this.paso.set('revision');
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo leer el documento.');
      this.paso.set('inicio');
    }
  }

  // ── Paso 2: revisión ────────────────────────────────────────────────────────
  toggleSel(i: number) {
    this.filas.update((fs) => fs.map((f, k) => (k === i ? { ...f, sel: !f.sel } : f)));
  }
  elegirVehiculo(i: number, vehiculoId: string) {
    this.filas.update((fs) => fs.map((f, k) =>
      k === i ? { ...f, vehiculoElegido: vehiculoId || null, sel: !!vehiculoId && TIPOS_APLICABLES.has(f.tipo) } : f));
  }

  esAplicable(f: FilaRevision): boolean { return TIPOS_APLICABLES.has(f.tipo); }

  // ── DE1 (Ronda DE) — panel «Asignar…» ──────────────────────────────────────
  abrirPanel(i: number) {
    if (this.paso() !== 'revision') return;
    this.panelAbiertoIndex.set(i);
  }
  cerrarPanel() {
    this.panelAbiertoIndex.set(null);
  }
  asignarDesdePanel(vehiculoId: string) {
    const i = this.panelAbiertoIndex();
    if (i === null) return;
    this.elegirVehiculo(i, vehiculoId);
    this.cerrarPanel();
  }
  /** «Este documento no es de la flota»: deja la fila sin elegir y marcada para omitirse. */
  omitirDesdePanel() {
    const i = this.panelAbiertoIndex();
    if (i === null) return;
    this.filas.update((fs) => fs.map((f, k) => (k === i ? { ...f, vehiculoElegido: null, sel: false } : f)));
    this.cerrarPanel();
  }

  tipoLabel(t: TipoDocumentoFlota): string {
    return { seguro: 'Seguro', matricula: 'Matrícula', marbete_dgii: 'Marbete DGII', licencia: 'Licencia', otro: 'Otro', reverso: 'Reverso' }[t];
  }

  /** «Qué se actualiza» — espejo de las reglas del RPC (solo informativo). */
  queActualiza(f: FilaRevision): string {
    const c = f.campos;
    const partes: string[] = [];
    if (f.tipo === 'seguro') {
      if (c.poliza) partes.push(`póliza ${c.poliza}`);
      if (c.aseguradora) partes.push(c.aseguradora);
      if (c.vigencia_hasta) partes.push(`vence ${this.fecha(c.vigencia_hasta)}`);
    } else if (f.tipo === 'matricula') {
      if (c.numero_matricula) partes.push(`matrícula ${c.numero_matricula}`);
      if (c.vigencia_hasta) partes.push(`vence ${this.fecha(c.vigencia_hasta)}`);
    } else if (f.tipo === 'marbete_dgii') {
      if (c.marbete_numero) partes.push(`marbete ${c.marbete_numero}`);
      if (c.vigencia_hasta) partes.push(`vence ${this.fecha(c.vigencia_hasta)}`);
    }
    return partes.join(' · ') || '—';
  }

  private fecha(iso: string): string {
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  displayVehiculo(v: Vehiculo): string {
    return displayVehiculoCompleto(v);
  }

  vehiculoPorId(id: string): Vehiculo | undefined {
    return this.vehiculos().find((v) => v.id === id);
  }

  // ── Paso 3: aplicar ─────────────────────────────────────────────────────────
  async aplicar() {
    const sel = this.seleccionadas();
    if (!sel.length) return;
    this.paso.set('aplicando');
    this.error.set('');
    try {
      const filas: FilaAplicar[] = [];
      for (const f of sel) {
        let imagenPath: string | null = null;
        if (f.thumb) {
          try {
            imagenPath = await this.lector.subirImagenPagina(f.vehiculoElegido as string, f.tipo, dataUrlABlob(f.thumb));
          } catch { /* sin imagen igual se aplican los campos */ }
        }
        // DE2/DE-05 — el reverso emparejado sube aparte y se referencia en la
        // misma fila del anverso (el RPC lo guarda como segundo documento).
        let reversoPath: string | null = null;
        if (f.reversoThumb) {
          try {
            reversoPath = await this.lector.subirImagenPagina(f.vehiculoElegido as string, 'reverso', dataUrlABlob(f.reversoThumb));
          } catch { /* sin reverso igual se aplica el anverso */ }
        }
        filas.push({
          vehiculo_id: f.vehiculoElegido as string,
          tipo: f.tipo as FilaAplicar['tipo'],
          campos: f.campos,
          imagen_path: imagenPath,
          reverso_imagen_path: reversoPath,
          pagina: f.pagina,
        });
      }
      const resultados = await this.lector.aplicar(filas);
      this.resultados.set(resultados);
      const porPagina = new Map(resultados.map((r) => [Number(r.pagina), r] as const));
      this.filas.update((fs) => fs.map((f) => ({ ...f, resultado: porPagina.get(f.pagina) ?? f.resultado ?? null })));
      this.paso.set('resultado');
      const ok = resultados.filter((r) => r.ok).length;
      this.toast.success('Documentos aplicados', `${ok} de ${resultados.length} fila(s) actualizada(s).`);
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo aplicar.');
      this.paso.set('revision');
    }
  }

  reiniciar() {
    this.paso.set('inicio');
    this.filas.set([]);
    this.resultados.set([]);
    this.error.set('');
    this.pdfBuffer = null;
    this.panelAbiertoIndex.set(null);
  }

  private aBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  private aDataUrl(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error('No se pudo leer la foto.'));
      r.readAsDataURL(f);
    });
  }
}
