import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { TransporteV3Service, ProveedorTransporte, LugarBuscado } from '../../../../shared/services/transporte-v3.service';
import { SolicitudesMaterialService } from '../../../../shared/services/solicitudes-material.service';
import { ArticulosService } from '../../../../shared/services/articulos.service';
import { CategoriasService } from '../../../../shared/services/categorias.service';
import { Articulo } from '../../../../shared/models/articulo.model';
import { Categoria } from '../../../../shared/models/categoria.model';
import { ArticuloPicker, ArticuloPickerSelection } from '../../../../shared/ui/articulo-picker/articulo-picker';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { Icon } from '../../../../shared/ui/icon/icon';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { MotionService } from '../../../../shared/services/motion.service';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';

/** BV6 — un renglón de material del catálogo dentro del conduce externo. */
interface ItemConduce {
  articuloId: string | null;
  cantidad: number;
}

/** Lugar seleccionado (del sistema) o texto libre («Otros»). */
interface LugarSel {
  texto: string;
  lat: number | null;
  lng: number | null;
  proyectoId: string | null;
  bodegaId: string | null;
}

/**
 * BA / Transporte v3 — alta de un CONDUCE EXTERNO (un proveedor mueve material
 * con su camión). Fotos de placa (obligatoria) y carga, quién transporta
 * (catálogo + «Otro» al vuelo), material (descripción libre) y origen→destino
 * (buscador del sistema + «Otros»). Al emitir se registra el viaje automático.
 */
@Component({
  selector: 'app-conduce-externo-form',
  imports: [RouterLink, ArticuloPicker, TranslatePipe, Icon],
  templateUrl: './conduce-externo-form.html',
  styleUrl: './conduce-externo-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConduceExternoForm {
  private svc = inject(TransporteV3Service);
  private solicitudes = inject(SolicitudesMaterialService);
  private articulosSvc = inject(ArticulosService);
  private categoriasSvc = inject(CategoriasService);
  private toast = inject(ToastService);
  private user = inject(UserService);
  private motion = inject(MotionService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // CL1 — los 3 proveedores más a mano (quick-pick en la tarjeta 1).
  top3Proveedores = computed(() => this.proveedores().slice(0, 3));
  // CL1 — material del catálogo plegado por defecto.
  materialAbierto = signal(false);

  // CL1 — vista previa / progreso: 4 obligatorios (placa, transporta, origen, destino).
  private tieneTransporta = computed(() =>
    this.usarTexto() ? this.transportaTexto().trim().length > 0 : !!this.proveedorId());
  private tieneOrigen = computed(() => !!this.origenSel() || this.origenQuery().trim().length > 0);
  private tieneDestino = computed(() => !!this.destinoSel() || this.destinoQuery().trim().length > 0);
  listos = computed(() =>
    [!!this.placaFile(), this.tieneTransporta(), this.tieneOrigen(), this.tieneDestino()]
      .filter(Boolean).length);
  faltan = computed(() => {
    const f: string[] = [];
    if (!this.placaFile()) f.push('foto de la placa');
    if (!this.tieneTransporta()) f.push('quién transporta');
    if (!this.tieneOrigen()) f.push('origen');
    if (!this.tieneDestino()) f.push('destino');
    return f;
  });
  puedeEmitir = computed(() => this.listos() === 4 && !this.guardando());

  // CL6 — solo un admin puede marcar un conduce nuevo como dato de prueba (el servidor
  // lo re-valida: crear_conduce_externo rechaza p_es_prueba=true a no-admin).
  esAdmin = computed(() => this.user.hasRole('admin'));
  esPrueba = signal(false);

  // BR5 — cuando se abre desde una requisición ("Comprar en ferretería"): queda
  // enlazado (origen_requisicion_id) y cuenta en el avance al confirmarse la compra.
  origenRequisicionId = signal<string | null>(null);
  reqCodigo = signal<string>('');

  // Proveedor
  proveedores = signal<ProveedorTransporte[]>([]);
  proveedorId = signal<string | null>(null);
  transportaTexto = signal('');
  usarTexto = signal(false); // «Otro» a mano
  // Alta de proveedor al vuelo
  nuevoAbierto = signal(false);
  nuevoNombre = signal('');
  nuevoTel = signal('');

  // Material + fotos
  material = signal('');
  placaFile = signal<File | null>(null);
  placaPreview = signal<string | null>(null);
  cargaFile = signal<File | null>(null);
  cargaPreview = signal<string | null>(null);

  // Origen / destino
  origenQuery = signal('');
  origenResultados = signal<LugarBuscado[]>([]);
  origenSel = signal<LugarSel | null>(null);
  destinoQuery = signal('');
  destinoResultados = signal<LugarBuscado[]>([]);
  destinoSel = signal<LugarSel | null>(null);
  // BV4 — requisiciones activas de la obra destino (aviso: el material puede cubrirlas).
  reqsActivasDestino = signal<{ id: string; folio: number | null }[]>([]);

  // BV6 — material del catálogo (opcional). Si origen o destino es un almacén
  // nuestro, estos renglones mueven inventario (salida / entrada pendiente).
  articulos = signal<Articulo[]>([]);
  categorias = signal<Categoria[]>([]);
  items = signal<ItemConduce[]>([]);

  /** ¿Alguno de los extremos es un almacén nuestro? → el material toca inventario. */
  afectaInventario = computed(() => !!this.origenSel()?.bodegaId || !!this.destinoSel()?.bodegaId);
  /** Sentido del impacto para el aviso al usuario. */
  sentidoInventario = computed<'salida' | 'entrada' | null>(() => {
    if (this.origenSel()?.bodegaId) return 'salida';
    if (this.destinoSel()?.bodegaId) return 'entrada';
    return null;
  });

  guardando = signal(false);
  formError = signal('');

  async ngOnInit() {
    try {
      this.proveedores.set(await this.svc.proveedores());
    } catch {
      /* catálogo vacío no es error */
    }
    try {
      const [arts, cats] = await Promise.all([this.articulosSvc.getAll(), this.categoriasSvc.getAll()]);
      this.articulos.set(arts.filter((a) => a.activo));
      this.categorias.set(cats);
    } catch {
      /* sin catálogo el conduce sigue siendo solo de transporte */
    }
    // BR5 — abierto desde una requisición: enlaza + prellena destino (obra) y material.
    const qp = this.route.snapshot.queryParamMap;
    const reqId = qp.get('requisicion');
    if (reqId) {
      this.origenRequisicionId.set(reqId);
      this.reqCodigo.set('REQ-' + reqId.slice(0, 6).toUpperCase());
      const destino = qp.get('destino');
      if (destino) { this.destinoQuery.set(destino); }
      try {
        const pend = await this.solicitudes.pendientesParaCompra(reqId);
        const conFaltante = pend.filter((p) => p.pendiente > 0);
        if (conFaltante.length) {
          this.material.set(
            'Compra para ' + this.reqCodigo() + ':\n' +
            conFaltante.map((p) => `- ${p.nombre} x ${p.pendiente}`).join('\n'),
          );
        }
      } catch { /* si no se pueden leer los pendientes, el material queda editable */ }
    }
  }

  // ── Proveedor ─────────────────────────────────────────────────────────────
  /** CL1 — elegir un proveedor de los "más a mano". */
  elegirProveedor(id: string) {
    this.usarTexto.set(false);
    this.nuevoAbierto.set(false);
    this.proveedorId.set(id);
  }

  toggleTexto() {
    this.usarTexto.update((v) => !v);
    this.proveedorId.set(null);
    this.transportaTexto.set('');
  }

  async crearProveedorRapido() {
    const nombre = this.nuevoNombre().trim();
    if (!nombre) { this.toast.warning('Escribe el nombre del proveedor'); return; }
    try {
      const id = await this.svc.crearProveedor({ nombre, telefono: this.nuevoTel().trim() || null });
      this.proveedores.set(await this.svc.proveedores());
      this.proveedorId.set(id);
      this.usarTexto.set(false);
      this.nuevoAbierto.set(false);
      this.nuevoNombre.set('');
      this.nuevoTel.set('');
      this.toast.success('Proveedor creado', 'Queda "sin ratificar" hasta que Logística lo oficialice.');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo crear el proveedor');
    }
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  async onFoto(kind: 'placa' | 'carga', event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.setFoto(kind, file);
  }

  /** CL1 — arrastrar y soltar una imagen en la casilla. */
  async onDropFoto(kind: 'placa' | 'carga', event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) await this.setFoto(kind, file);
  }

  private async setFoto(kind: 'placa' | 'carga', file: File) {
    const c = await comprimirImagen(file);
    const url = URL.createObjectURL(c);
    if (kind === 'placa') {
      const prev = this.placaPreview(); if (prev) URL.revokeObjectURL(prev);
      this.placaFile.set(c); this.placaPreview.set(url);
    } else {
      const prev = this.cargaPreview(); if (prev) URL.revokeObjectURL(prev);
      this.cargaFile.set(c); this.cargaPreview.set(url);
    }
  }

  // ── Buscador de lugares ─────────────────────────────────────────────────────
  async buscarOrigen(v: string) {
    this.origenQuery.set(v);
    this.origenSel.set(null);
    this.origenResultados.set(v.trim().length >= 2 ? await this.svc.buscarLugares(v) : []);
  }
  async buscarDestino(v: string) {
    this.destinoQuery.set(v);
    this.destinoSel.set(null);
    this.reqsActivasDestino.set([]);
    this.destinoResultados.set(v.trim().length >= 2 ? await this.svc.buscarLugares(v) : []);
  }
  elegirOrigen(l: LugarBuscado) {
    this.origenSel.set(this.aSel(l));
    this.origenQuery.set(l.nombre);
    this.origenResultados.set([]);
  }
  elegirDestino(l: LugarBuscado) {
    const sel = this.aSel(l);
    this.destinoSel.set(sel);
    this.destinoQuery.set(l.nombre);
    this.destinoResultados.set([]);
    // BV4 — si el destino es una obra, avisa de sus requisiciones activas.
    this.reqsActivasDestino.set([]);
    if (sel.proyectoId) {
      void this.solicitudes.activasDeObra(sel.proyectoId)
        .then((r) => this.reqsActivasDestino.set(r))
        .catch(() => { /* aviso best-effort */ });
    }
  }

  /** BV4 — código citable REQ-XXXXXX de una requisición activa del destino. */
  reqCodigoDe(folio: number | null): string {
    return folio != null ? 'REQ-' + String(folio).padStart(6, '0') : 'REQ';
  }
  private aSel(l: LugarBuscado): LugarSel {
    return {
      texto: l.nombre,
      lat: l.lat, lng: l.lng,
      proyectoId: l.tipo === 'obra' ? l.id : null,
      bodegaId: l.tipo === 'almacen' ? l.id : null,
    };
  }

  // ── Material del catálogo (BV6) ──────────────────────────────────────────────
  agregarItem() {
    this.items.update((xs) => [...xs, { articuloId: null, cantidad: 1 }]);
  }
  quitarItem(i: number) {
    this.items.update((xs) => xs.filter((_, idx) => idx !== i));
  }
  onArticuloElegido(i: number, sel: ArticuloPickerSelection) {
    this.items.update((xs) => xs.map((it, idx) => (idx === i ? { ...it, articuloId: sel.articuloId } : it)));
  }
  setCantidad(i: number, value: string) {
    const n = Number(value);
    this.items.update((xs) => xs.map((it, idx) => (idx === i ? { ...it, cantidad: isNaN(n) ? 0 : n } : it)));
  }

  // ── Emitir ──────────────────────────────────────────────────────────────────
  async guardar() {
    if (this.guardando()) return;
    this.formError.set('');
    if (!this.placaFile()) { this.formError.set('La foto de la placa del camión es obligatoria.'); return; }
    const provOk = this.usarTexto() ? this.transportaTexto().trim().length > 0 : !!this.proveedorId();
    if (!provOk) { this.formError.set('Indica quién transporta (proveedor o texto «Otro»).'); return; }

    // BV6 — renglones de material: los completos (artículo + cantidad>0) mueven inventario.
    const itemsRaw = this.items();
    if (itemsRaw.some((it) => it.articuloId && it.cantidad <= 0)) {
      this.formError.set('Cada material del catálogo debe tener una cantidad mayor a 0.');
      return;
    }
    const itemsPayload = itemsRaw
      .filter((it): it is { articuloId: string; cantidad: number } => !!it.articuloId && it.cantidad > 0)
      .map((it) => ({ articulo_id: it.articuloId, cantidad: it.cantidad }));

    this.guardando.set(true);
    try {
      const placaPath = await this.svc.subirFoto('placa', this.placaFile()!);
      const cargaPath = this.cargaFile() ? await this.svc.subirFoto('carga', this.cargaFile()!) : null;
      // Origen/destino: usa la selección del sistema, o el texto crudo como «Otros».
      const o = this.origenSel() ?? this.textoComoSel(this.origenQuery());
      const d = this.destinoSel() ?? this.textoComoSel(this.destinoQuery());
      const id = await this.svc.crearConduceExterno({
        proveedorId: this.usarTexto() ? null : this.proveedorId(),
        transportaTexto: this.usarTexto() ? this.transportaTexto().trim() : null,
        placaFotoPath: placaPath,
        cargaFotoPath: cargaPath,
        materialDescripcion: this.material().trim() || null,
        origen: o?.texto ?? null, origenLat: o?.lat ?? null, origenLng: o?.lng ?? null,
        origenProyectoId: o?.proyectoId ?? null, origenBodegaId: o?.bodegaId ?? null,
        destino: d?.texto ?? null, destinoLat: d?.lat ?? null, destinoLng: d?.lng ?? null,
        destinoProyectoId: d?.proyectoId ?? null, destinoBodegaId: d?.bodegaId ?? null,
        origenRequisicionId: this.origenRequisicionId(),
        items: itemsPayload.length ? itemsPayload : null,
        esPrueba: this.esAdmin() && this.esPrueba(),
      });
      // CJ2 — celebración grande (overlay global del shell), con enlace a la ficha.
      this.motion.celebrar('conduce', {
        numero: 'CE', destino: d?.texto ?? null,
        verUrl: `/inventario/conduces-externos/${id}`, verLabel: 'Ver conduce',
      });
      this.toast.success('Conduce externo emitido', 'El viaje quedó registrado (pendiente de pago).');
      this.router.navigate(['/inventario/conduces-externos'], { queryParams: { nuevo: id } });
    } catch (e) {
      // BT7/regla 16: nunca el `e.message` crudo (FK/SQL) en pantalla. `humanizeError`
      // deja pasar los mensajes de negocio (22023 «Revisar dato») y traduce lo técnico.
      this.formError.set(humanizeError(e).mensaje);
      this.toast.errorFrom(e, 'No se pudo emitir el conduce');
    } finally {
      this.guardando.set(false);
    }
  }

  private textoComoSel(v: string): LugarSel | null {
    const t = v.trim();
    return t ? { texto: t, lat: null, lng: null, proyectoId: null, bodegaId: null } : null;
  }
}
