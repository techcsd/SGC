import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TecnologiaService, CompraTecFormPayload } from '../../../../../shared/services/tecnologia.service';
import { ProyectosService } from '../../../../../shared/services/proyectos.service';
import { UnidadesService } from '../../../../../shared/services/unidades.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { UserService } from '../../../../core/services/user.service';
import { SolicitudCompra, SolicitudCompraAdjunto, LecturaCotizacion } from '../../../../../shared/models/solicitud.model';
import { Icon } from '../../../../../shared/ui/icon/icon';
import { ButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { FileUpload } from '../../../../../shared/ui/file-upload/file-upload';
import { humanizeError } from '../../../../../shared/utils/friendly-error.util';

const UNIDADES_FALLBACK: { codigo: string; nombre: string }[] = [
  { codigo: 'unidad', nombre: 'Unidad' },
  { codigo: 'licencia', nombre: 'Licencia' },
  { codigo: 'servicio', nombre: 'Servicio' },
  { codigo: 'caja', nombre: 'Caja' },
  { codigo: 'paquete', nombre: 'Paquete' },
];

interface ItemRow {
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number | null;
}
function nuevoItem(): ItemRow {
  return { descripcion: '', cantidad: 1, unidad: 'unidad', precio_unitario: null };
}

/** CQ1 — una cotización en el formulario: ya guardada en el servidor, o aún
 *  pendiente de subir (se sube al guardar el borrador). */
interface CotizacionPendiente {
  localId: string;
  file: File;
  nombre: string;
  leyendo: boolean;
  error: string | null;
  lectura: LecturaCotizacion | null;
  lecturaCostoUsd: number | null;
  proveedor: string | null;
  monto: number | null;
  fecha: string | null;
}
type CotizacionVista =
  | { tipo: 'existente'; key: string; adjunto: SolicitudCompraAdjunto }
  | { tipo: 'pendiente'; key: string; data: CotizacionPendiente };

@Component({
  selector: 'app-tec-compras-nueva',
  imports: [ReactiveFormsModule, RouterLink, Icon, ButtonDirective, FileUpload, DecimalPipe],
  templateUrl: './compras-nueva.html',
  styleUrl: './compras-nueva.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComprasNueva implements OnInit {
  private tecnologia = inject(TecnologiaService);
  private proyectosService = inject(ProyectosService);
  private unidadesService = inject(UnidadesService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // ── Modo edición: viene un :id en la ruta y YA existe en 'borrador' ─────────
  compraId = signal<string | null>(null);
  modoEdicion = computed(() => this.compraId() !== null);
  cargando = signal(true);
  guardando = signal(false);
  enviando = signal(false);
  error = signal('');

  aprobadorNombre = signal<string | null>(null);
  envioLabel = computed(() => {
    const n = this.aprobadorNombre();
    return n ? `Enviar a ${n.split(' ')[0]} para aprobar` : 'Enviar para aprobar';
  });
  proyectos = signal<{ id: string; nombre: string }[]>([]);
  unidadesCatalogo = signal<{ codigo: string; nombre: string }[]>(UNIDADES_FALLBACK);

  form = new FormGroup({
    titulo: new FormControl<string | null>(null),
    paraQuien: new FormControl<string | null>(null),
    urgencia: new FormControl<'normal' | 'urgente'>('normal', { nonNullable: true }),
    proyectoId: new FormControl<string | null>(null),
    justificacion: new FormControl<string | null>(null),
  });

  items = signal<ItemRow[]>([nuevoItem()]);
  // Señal propia (no FormControl) para que los `computed()` de totales reaccionen
  // de inmediato — un FormControl.value no es un signal y no dispara recomputo.
  itbisIncluido = signal(false);
  toggleItbisIncluido(checked: boolean) {
    this.itbisIncluido.set(checked);
  }

  // ── Cotizaciones: existentes (ya en servidor, modo edición) + pendientes (recién soltadas) ──
  cotizacionesExistentes = signal<SolicitudCompraAdjunto[]>([]);
  cotizacionesPendientes = signal<CotizacionPendiente[]>([]);
  /** key de la cotización marcada ★ (adjunto.id si es existente, localId si es pendiente). */
  elegidaKey = signal<string | null>(null);
  llenadoDesdeIA = signal<string | null>(null); // nombre del archivo que llenó los artículos

  cotizaciones = computed<CotizacionVista[]>(() => [
    ...this.cotizacionesExistentes().map((a) => ({ tipo: 'existente' as const, key: a.id, adjunto: a })),
    ...this.cotizacionesPendientes().map((p) => ({ tipo: 'pendiente' as const, key: p.localId, data: p })),
  ]);
  hayCotizaciones = computed(() => this.cotizaciones().length > 0);

  // ── Totales (SIEMPRE recalculados en cliente para la vista previa; el servidor
  //    los vuelve a calcular al guardar — regla 3, nunca confiar en el total del cliente). ──
  suma = computed(() => this.items().reduce((acc, it) => acc + (it.cantidad || 0) * (it.precio_unitario ?? 0), 0));
  subtotal = computed(() => (this.itbisIncluido() ? this.suma() / 1.18 : this.suma()));
  itbisCalc = computed(() => (this.itbisIncluido() ? this.suma() - this.subtotal() : this.subtotal() * 0.18));
  total = computed(() => (this.itbisIncluido() ? this.suma() : this.subtotal() + this.itbisCalc()));

  /** Monto de referencia de la cotización ★elegida (monto indicado o el total que leyó la IA). */
  private montoElegida = computed<number | null>(() => {
    const key = this.elegidaKey();
    if (!key) return null;
    const vista = this.cotizaciones().find((c) => c.key === key);
    if (!vista) return null;
    if (vista.tipo === 'existente') return vista.adjunto.monto ?? vista.adjunto.lectura?.total ?? null;
    return vista.data.monto ?? vista.data.lectura?.total ?? null;
  });
  /** Aviso ámbar: el total capturado difiere >1% del de la cotización elegida. */
  descuadre = computed(() => {
    const ref = this.montoElegida();
    if (!ref || ref <= 0) return null;
    const diff = Math.abs(this.total() - ref) / ref;
    return diff > 0.01 ? { ref, diff } : null;
  });

  puedeEnviar = computed(
    () => this.items().some((i) => i.descripcion.trim() && (i.precio_unitario ?? 0) > 0) && this.hayCotizaciones(),
  );

  miUsuarioId = computed(() => this.userService.profile()?.id ?? null);

  async ngOnInit() {
    void this.tecnologia.getAprobadorCompraTecNombre().then((n) => this.aprobadorNombre.set(n));
    try {
      const [proyectos, unidades] = await Promise.all([
        this.proyectosService.getDirectorio('admin').catch(() => []),
        this.unidadesService.getActivas().catch(() => []),
      ]);
      this.proyectos.set(proyectos.map((p) => ({ id: p.id, nombre: p.nombre })));
      if (unidades.length) this.unidadesCatalogo.set(unidades.map((u) => ({ codigo: u.codigo, nombre: u.nombre })));
    } catch { /* selects caen a los fallbacks */ }

    const id = this.route.snapshot.paramMap.get('id');
    if (id) await this.cargarParaEditar(id);
    this.cargando.set(false);
  }

  private async cargarParaEditar(id: string) {
    try {
      const c = await this.tecnologia.getCompraTecById(id);
      if (!c) {
        this.toast.error('No se encontró esa compra tecnológica.');
        this.router.navigate(['/tecnologia/compras']);
        return;
      }
      if (c.estado !== 'borrador') {
        this.toast.error('Esta compra ya no es un borrador', 'Solo se puede editar mientras está en borrador. Ábrela para ver su estado.');
        this.router.navigate(['/tecnologia/compras'], { queryParams: { id: c.id } });
        return;
      }
      const esDueno = c.solicitante_id === this.miUsuarioId();
      if (!esDueno && !this.userService.hasRole('admin')) {
        this.toast.error('No autorizado', 'Solo quien la creó (o un admin) puede editarla.');
        this.router.navigate(['/tecnologia/compras']);
        return;
      }
      this.compraId.set(c.id);
      this.aplicarCompraAlFormulario(c);
    } catch (e: unknown) {
      this.error.set(humanizeError(e).mensaje);
    }
  }

  /** "Para quién / área" no tiene columna propia — se guarda como la primera línea
   *  de `notas` ("Para: X"). Aquí se separa de vuelta al cargar un borrador. */
  private aplicarCompraAlFormulario(c: SolicitudCompra) {
    let paraQuien: string | null = null;
    let justificacion = c.notas ?? '';
    const m = justificacion.match(/^Para:\s*(.+?)\n\n([\s\S]*)$/);
    if (m) { paraQuien = m[1]; justificacion = m[2]; }

    this.form.setValue({
      titulo: c.titulo ?? null,
      paraQuien,
      urgencia: (c.urgencia as 'normal' | 'urgente') ?? 'normal',
      proyectoId: c.proyecto_id ?? null,
      justificacion: justificacion || null,
    });
    this.itbisIncluido.set(!!c.itbis_incluido);

    const items = (c.items ?? []).map((it) => ({
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      unidad: it.unidad ?? 'unidad',
      precio_unitario: it.precio_unitario ?? null,
    }));
    this.items.set(items.length ? items : [nuevoItem()]);

    this.cotizacionesExistentes.set(c.adjuntos ?? []);
    const elegida = (c.adjuntos ?? []).find((a) => a.elegida);
    if (elegida) this.elegidaKey.set(elegida.id);
  }

  // ── Encabezado ───────────────────────────────────────────────
  volver() {
    this.router.navigate(['/tecnologia/compras']);
  }

  // ── Artículos ────────────────────────────────────────────────
  addItem() {
    this.items.update((list) => [...list, nuevoItem()]);
  }
  removeItem(i: number) {
    this.items.update((list) => (list.length > 1 ? list.filter((_, idx) => idx !== i) : list));
  }
  updateItem(i: number, field: keyof ItemRow, value: string) {
    this.items.update((list) =>
      list.map((it, idx) => {
        if (idx !== i) return it;
        if (field === 'cantidad' || field === 'precio_unitario') {
          const n = value.trim() === '' ? (field === 'precio_unitario' ? null : 0) : Number(value);
          return { ...it, [field]: Number.isNaN(n as number) ? (field === 'precio_unitario' ? null : 0) : n };
        }
        return { ...it, [field]: value };
      }),
    );
  }
  /** Enter en el último campo de la última fila agrega una fila nueva (mock). */
  onUltimoCampoEnter(i: number, event: Event) {
    event.preventDefault();
    if (i === this.items().length - 1) this.addItem();
  }

  /** Aplica los artículos leídos de una cotización (propia o del servidor) a la tabla. */
  usarLecturaParaArticulos(lectura: LecturaCotizacion, nombreArchivo: string) {
    if (!lectura.articulos.length) return;
    this.items.set(
      lectura.articulos.map((a) => ({
        descripcion: a.descripcion || '',
        cantidad: a.cantidad && a.cantidad > 0 ? a.cantidad : 1,
        unidad: a.unidad || 'unidad',
        precio_unitario: a.precio ?? null,
      })),
    );
    this.llenadoDesdeIA.set(nombreArchivo);
  }

  // ── Cotizaciones: dropzone ───────────────────────────────────
  onCotizacionFiles(files: File[]) {
    const esPrimera = this.cotizaciones().length === 0;
    for (const file of files) {
      const localId = crypto.randomUUID();
      const row: CotizacionPendiente = {
        localId, file, nombre: file.name, leyendo: true, error: null,
        lectura: null, lecturaCostoUsd: null, proveedor: null, monto: null, fecha: null,
      };
      this.cotizacionesPendientes.update((list) => [...list, row]);
      if (esPrimera && !this.elegidaKey()) this.elegidaKey.set(localId);
      void this.leerCotizacionPendiente(localId, file);
    }
  }

  private async leerCotizacionPendiente(localId: string, file: File) {
    const esLaPrimeraDelFormulario = this.cotizaciones().length === 1; // solo esta, nada más en la lista
    try {
      const res = await this.tecnologia.leerCotizacion(file);
      this.cotizacionesPendientes.update((list) =>
        list.map((p) =>
          p.localId === localId
            ? {
                ...p,
                leyendo: false,
                error: res.ok ? null : res.error || 'No se pudo leer la cotización.',
                lectura: res.ok ? res.lectura ?? null : null,
                lecturaCostoUsd: res.ok ? res.costo_usd ?? null : null,
                proveedor: res.ok ? res.lectura?.proveedor ?? null : null,
                monto: res.ok ? res.lectura?.total ?? null : null,
                fecha: res.ok ? res.lectura?.fecha ?? null : null,
              }
            : p,
        ),
      );
      // Auto-llena los artículos SOLO si es la primera (y única) cotización del
      // formulario — para no pisar en silencio lo que el usuario ya revisó/editó.
      if (res.ok && res.lectura && esLaPrimeraDelFormulario && !this.llenadoDesdeIA()) {
        this.usarLecturaParaArticulos(res.lectura, file.name);
      }
    } catch (e: unknown) {
      this.cotizacionesPendientes.update((list) =>
        list.map((p) => (p.localId === localId ? { ...p, leyendo: false, error: humanizeError(e).mensaje } : p)),
      );
    }
  }

  removeCotizacionPendiente(localId: string) {
    this.cotizacionesPendientes.update((list) => list.filter((p) => p.localId !== localId));
    if (this.elegidaKey() === localId) this.elegidaKey.set(this.cotizaciones()[0]?.key ?? null);
  }

  /** Marca una cotización como ★ la elegida. Si ya está guardada en el servidor,
   *  lo refleja de inmediato (la ficha de detalle usa la misma fuente). */
  async elegirCotizacion(vista: CotizacionVista) {
    this.elegidaKey.set(vista.key);
    if (vista.tipo === 'existente') {
      try {
        await this.tecnologia.elegirCotizacion(vista.adjunto.id);
        this.cotizacionesExistentes.update((list) => list.map((a) => ({ ...a, elegida: a.id === vista.adjunto.id })));
      } catch (e: unknown) {
        this.toast.error('No se pudo marcar como elegida', humanizeError(e).mensaje);
      }
    }
  }

  // ── Guardar / enviar ─────────────────────────────────────────
  private construirPayload(): CompraTecFormPayload {
    const v = this.form.getRawValue();
    const paraQuien = (v.paraQuien ?? '').trim();
    const justificacion = (v.justificacion ?? '').trim();
    const notas = paraQuien ? `Para: ${paraQuien}\n\n${justificacion}` : justificacion || null;
    return {
      notas,
      titulo: (v.titulo ?? '').trim() || null,
      urgencia: v.urgencia,
      proyecto_id: v.proyectoId || null,
      itbis_incluido: this.itbisIncluido(),
      items: this.items()
        .filter((i) => i.descripcion.trim() && i.cantidad > 0)
        .map((i) => ({ descripcion: i.descripcion.trim(), cantidad: i.cantidad, unidad: i.unidad || null, precio_unitario: i.precio_unitario })),
    };
  }

  /** Guarda el borrador (crea o actualiza) y sube las cotizaciones pendientes.
   *  Devuelve el id de la compra, o null si algo falló (ya se avisó al usuario). */
  private async persistir(): Promise<string | null> {
    const payload = this.construirPayload();
    if (payload.items.length === 0) {
      this.error.set('Agrega al menos un artículo con descripción y cantidad mayor a 0.');
      return null;
    }
    this.error.set('');
    try {
      let id = this.compraId();
      if (id) {
        await this.tecnologia.actualizarBorradorCompraTec(id, payload);
      } else {
        id = await this.tecnologia.crearCompraTec(payload);
        this.compraId.set(id);
        this.router.navigate(['/tecnologia/compras', id, 'editar'], { replaceUrl: true });
      }

      // Sube las cotizaciones pendientes (que ya terminaron de leerse o no).
      const pendientes = this.cotizacionesPendientes();
      const nuevosIds: Record<string, string> = {};
      for (const p of pendientes) {
        const adjId = await this.tecnologia.subirCotizacion(id, p.file, {
          tipo: 'cotizacion', proveedor: p.proveedor, monto: p.monto,
          fecha: p.fecha, lectura: p.lectura, lectura_costo_usd: p.lecturaCostoUsd,
        });
        nuevosIds[p.localId] = adjId;
      }

      // Refresca desde el servidor para tener los adjuntos reales (con su id/elegida).
      const actualizada = await this.tecnologia.getCompraTecById(id);
      if (actualizada) {
        this.cotizacionesExistentes.set(actualizada.adjuntos ?? []);
        this.cotizacionesPendientes.set([]);
      }

      // Aplica la elección ★ (idempotente) sobre el id real, sea existente o recién subida.
      const elegidaKeyActual = this.elegidaKey();
      const elegidaIdReal = elegidaKeyActual ? (nuevosIds[elegidaKeyActual] ?? elegidaKeyActual) : null;
      if (elegidaIdReal) {
        await this.tecnologia.elegirCotizacion(elegidaIdReal);
        this.elegidaKey.set(elegidaIdReal);
        const refrescada = await this.tecnologia.getCompraTecById(id);
        if (refrescada) this.cotizacionesExistentes.set(refrescada.adjuntos ?? []);
      }

      return id;
    } catch (e: unknown) {
      this.error.set(humanizeError(e).mensaje);
      return null;
    }
  }

  async guardarBorrador() {
    if (this.guardando() || this.enviando()) return;
    this.guardando.set(true);
    try {
      const id = await this.persistir();
      if (id) this.toast.success('Borrador guardado', 'Puedes seguir editándolo o enviarlo a aprobación.');
    } finally {
      this.guardando.set(false);
    }
  }

  async enviarAprobacion() {
    if (this.guardando() || this.enviando()) return;
    if (!this.puedeEnviar()) {
      this.error.set('Falta al menos un artículo con precio y una cotización adjunta.');
      return;
    }
    this.enviando.set(true);
    try {
      const id = await this.persistir();
      if (!id) return;
      await this.tecnologia.enviarAprobacionCompraTec(id);
      this.toast.success('Enviada a aprobación', this.aprobadorNombre() ? `${this.aprobadorNombre()} ya puede revisarla.` : undefined);
      this.router.navigate(['/tecnologia/compras'], { queryParams: { id } });
    } catch (e: unknown) {
      this.error.set(humanizeError(e).mensaje);
    } finally {
      this.enviando.set(false);
    }
  }
}
