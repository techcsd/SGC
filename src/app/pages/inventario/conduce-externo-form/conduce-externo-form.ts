import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TransporteV3Service, ProveedorTransporte, LugarBuscado } from '../../../../shared/services/transporte-v3.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { comprimirImagen } from '../../../../shared/utils/comprimir-imagen.util';

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
  imports: [RouterLink],
  templateUrl: './conduce-externo-form.html',
  styleUrl: './conduce-externo-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConduceExternoForm {
  private svc = inject(TransporteV3Service);
  private toast = inject(ToastService);
  private router = inject(Router);

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

  guardando = signal(false);
  formError = signal('');

  async ngOnInit() {
    try {
      this.proveedores.set(await this.svc.proveedores());
    } catch {
      /* catálogo vacío no es error */
    }
  }

  // ── Proveedor ─────────────────────────────────────────────────────────────
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
    if (!file) return;
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
    this.destinoResultados.set(v.trim().length >= 2 ? await this.svc.buscarLugares(v) : []);
  }
  elegirOrigen(l: LugarBuscado) {
    this.origenSel.set(this.aSel(l));
    this.origenQuery.set(l.nombre);
    this.origenResultados.set([]);
  }
  elegirDestino(l: LugarBuscado) {
    this.destinoSel.set(this.aSel(l));
    this.destinoQuery.set(l.nombre);
    this.destinoResultados.set([]);
  }
  private aSel(l: LugarBuscado): LugarSel {
    return {
      texto: l.nombre,
      lat: l.lat, lng: l.lng,
      proyectoId: l.tipo === 'obra' ? l.id : null,
      bodegaId: l.tipo === 'almacen' ? l.id : null,
    };
  }

  // ── Emitir ──────────────────────────────────────────────────────────────────
  async guardar() {
    if (this.guardando()) return;
    this.formError.set('');
    if (!this.placaFile()) { this.formError.set('La foto de la placa del camión es obligatoria.'); return; }
    const provOk = this.usarTexto() ? this.transportaTexto().trim().length > 0 : !!this.proveedorId();
    if (!provOk) { this.formError.set('Indica quién transporta (proveedor o texto «Otro»).'); return; }

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
      });
      this.toast.success('Conduce externo emitido', 'El viaje quedó registrado (pendiente de pago).');
      this.router.navigate(['/inventario/conduces-externos'], { queryParams: { nuevo: id } });
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'No se pudo emitir el conduce.');
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
