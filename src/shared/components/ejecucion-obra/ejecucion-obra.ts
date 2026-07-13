import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ObraEjecucionService } from '../../services/obra-ejecucion.service';
import { ToastService } from '../../services/toast.service';
import { formatFechaDisplay } from '../../utils/fecha.util';
import {
  ObraElemento,
  ObraVaciado,
  ObraNoConformidad,
  VaciadoEstado,
  VACIADO_ESTADOS,
  NC_SEVERIDADES,
} from '../../models/obra-ejecucion.model';

/**
 * CSD-OPE-01 §8.2/§9 — Registro de Vaciado y No Conformidades, embebido en el
 * detalle del proyecto. Regla de oro: una NC abierta que bloquea impide liberar
 * o marcar como vaciado (lo aplica un trigger en la BD; aquí se muestra el error).
 */
@Component({
  selector: 'app-ejecucion-obra',
  imports: [FormsModule],
  templateUrl: './ejecucion-obra.html',
  styleUrl: './ejecucion-obra.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EjecucionObra {
  proyectoId = input.required<string>();

  private service = inject(ObraEjecucionService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;
  readonly VACIADO_ESTADOS = VACIADO_ESTADOS;
  readonly NC_SEVERIDADES = NC_SEVERIDADES;

  // ── Data ───────────────────────────────────────────────────
  elementos = signal<ObraElemento[]>([]);
  vaciados = signal<ObraVaciado[]>([]);
  ncs = signal<ObraNoConformidad[]>([]);
  loading = signal(true);
  error = signal('');

  // ── Derived ────────────────────────────────────────────────
  ncsOrdenadas = computed(() =>
    [...this.ncs()].sort((a, b) => {
      // abiertas primero
      if (a.estado !== b.estado) return a.estado === 'abierta' ? -1 : 1;
      return 0;
    }),
  );
  openBlockingCount = computed(
    () => this.ncs().filter((n) => n.estado === 'abierta' && n.bloquea_vaciado).length,
  );
  openCount = computed(() => this.ncs().filter((n) => n.estado === 'abierta').length);

  // ── NC form ────────────────────────────────────────────────
  ncDescripcion = signal('');
  ncSeveridad = signal<string>('media');
  ncBloquea = signal(true);
  ncElementoId = signal<string | null>(null);
  ncVaciadoId = signal<string | null>(null);
  ncSaving = signal(false);
  ncError = signal('');

  // ── Elemento form (compacto) ───────────────────────────────
  showElementoForm = signal(false);
  elTipo = signal<string | null>(null);
  elCodigo = signal('');
  elEje = signal('');
  elBloque = signal('');
  elSaving = signal(false);
  elError = signal('');

  // ── Vaciado form ───────────────────────────────────────────
  vElementoId = signal<string | null>(null);
  vNumero = signal<number | null>(null);
  vFecha = signal<string>('');
  vSaving = signal(false);
  vError = signal('');

  readonly TIPOS_ELEMENTO = [
    'excavacion',
    'fundacion',
    'columna',
    'viga',
    'losa',
    'muro',
    'escalera',
    'otro',
  ];

  constructor() {
    effect(() => {
      const id = this.proyectoId();
      if (id) this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [elementos, vaciados, ncs] = await Promise.all([
        this.service.getElementos(id),
        this.service.getVaciados(id),
        this.service.getNoConformidades(id),
      ]);
      this.elementos.set(elementos);
      this.vaciados.set(vaciados);
      this.ncs.set(ncs);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar la ejecución de obra.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  estadoLabel(value: string): string {
    return VACIADO_ESTADOS.find((e) => e.value === value)?.label ?? value;
  }
  estadoBadge(value: string): string {
    return VACIADO_ESTADOS.find((e) => e.value === value)?.badge ?? 'neutral';
  }
  severidadLabel(value: string): string {
    return NC_SEVERIDADES.find((s) => s.value === value)?.label ?? value;
  }
  severidadBadge(value: string): string {
    return NC_SEVERIDADES.find((s) => s.value === value)?.badge ?? 'neutral';
  }

  elementoLabel(id: string | null | undefined): string {
    if (!id) return '—';
    const el = this.elementos().find((e) => e.id === id);
    if (!el) return '—';
    const parts = [el.codigo, el.eje ? `eje ${el.eje}` : '', el.bloque ? `bloque ${el.bloque}` : '']
      .filter(Boolean)
      .join(' · ');
    return parts || (el.tipo ?? '—');
  }

  vaciadoLabel(v: ObraVaciado): string {
    const el = v.elemento;
    const parts = [
      el?.codigo,
      el?.eje ? `eje ${el.eje}` : '',
      el?.bloque ? `bloque ${el.bloque}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return parts || '—';
  }

  // ── No Conformidades ───────────────────────────────────────
  async crearNC() {
    if (this.ncSaving()) return;
    const descripcion = this.ncDescripcion().trim();
    if (!descripcion) {
      this.ncError.set('La descripción es obligatoria.');
      return;
    }
    this.ncSaving.set(true);
    this.ncError.set('');
    try {
      const created = await this.service.crearNC(this.proyectoId(), {
        elemento_id: this.ncElementoId(),
        vaciado_id: this.ncVaciadoId(),
        descripcion,
        severidad: this.ncSeveridad(),
        bloquea_vaciado: this.ncBloquea(),
      });
      this.ncs.update((list) => [created, ...list]);
      this.resetNCForm();
      this.toast.success('No Conformidad registrada', descripcion);
    } catch (e: unknown) {
      this.ncError.set(e instanceof Error ? e.message : 'Error al registrar la No Conformidad.');
    } finally {
      this.ncSaving.set(false);
    }
  }

  private resetNCForm() {
    this.ncDescripcion.set('');
    this.ncSeveridad.set('media');
    this.ncBloquea.set(true);
    this.ncElementoId.set(null);
    this.ncVaciadoId.set(null);
    this.ncError.set('');
  }

  async cerrarNC(nc: ObraNoConformidad) {
    const previo = this.ncs();
    this.ncs.update((list) =>
      list.map((n) =>
        n.id === nc.id ? { ...n, estado: 'cerrada', cerrada_en: new Date().toISOString() } : n,
      ),
    );
    try {
      await this.service.cerrarNC(nc.id);
      this.toast.success('No Conformidad cerrada');
    } catch (e: unknown) {
      this.ncs.set(previo);
      this.toast.error('No se pudo cerrar la NC', e instanceof Error ? e.message : undefined);
    }
  }

  // ── Elemento ───────────────────────────────────────────────
  openElementoForm() {
    this.resetElementoForm();
    this.showElementoForm.set(true);
  }
  cancelElementoForm() {
    this.showElementoForm.set(false);
  }
  private resetElementoForm() {
    this.elTipo.set(null);
    this.elCodigo.set('');
    this.elEje.set('');
    this.elBloque.set('');
    this.elError.set('');
  }

  async crearElemento() {
    if (this.elSaving()) return;
    const codigo = this.elCodigo().trim();
    if (!codigo && !this.elTipo()) {
      this.elError.set('Indica al menos un tipo o un código para el elemento.');
      return;
    }
    this.elSaving.set(true);
    this.elError.set('');
    try {
      const created = await this.service.crearElemento(this.proyectoId(), {
        tipo: this.elTipo(),
        codigo: codigo || null,
        eje: this.elEje().trim() || null,
        bloque: this.elBloque().trim() || null,
        descripcion: null,
      });
      this.elementos.update((list) => [...list, created]);
      this.vElementoId.set(created.id);
      this.showElementoForm.set(false);
      this.toast.success('Elemento agregado', codigo || (created.tipo ?? ''));
    } catch (e: unknown) {
      this.elError.set(e instanceof Error ? e.message : 'Error al agregar el elemento.');
    } finally {
      this.elSaving.set(false);
    }
  }

  // ── Vaciado ────────────────────────────────────────────────
  async crearVaciado() {
    if (this.vSaving()) return;
    if (this.elementos().length === 0) {
      this.vError.set('Primero agrega un elemento de obra.');
      return;
    }
    this.vSaving.set(true);
    this.vError.set('');
    try {
      const created = await this.service.crearVaciado(this.proyectoId(), {
        elemento_id: this.vElementoId(),
        numero: this.vNumero(),
        fecha: this.vFecha() || null,
      });
      this.vaciados.update((list) =>
        [...list, created].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
      );
      this.vNumero.set(null);
      this.vFecha.set('');
      this.toast.success('Vaciado agregado');
    } catch (e: unknown) {
      this.vError.set(e instanceof Error ? e.message : 'Error al agregar el vaciado.');
    } finally {
      this.vSaving.set(false);
    }
  }

  async setEstado(v: ObraVaciado, estado: VaciadoEstado) {
    const previo = this.vaciados();
    this.vaciados.update((list) => list.map((x) => (x.id === v.id ? { ...x, estado } : x)));
    try {
      const updated = await this.service.setEstadoVaciado(v.id, estado);
      this.vaciados.update((list) => list.map((x) => (x.id === v.id ? updated : x)));
      this.toast.success(`Vaciado ${this.estadoLabel(estado).toLowerCase()}`);
    } catch (e: unknown) {
      // El trigger bloquea por NC abierta: revertir y mostrar el mensaje de la BD.
      this.vaciados.set(previo);
      this.toast.error(
        'No se pudo cambiar el estado',
        e instanceof Error ? e.message : 'hay una No Conformidad abierta que lo bloquea',
      );
    }
  }
}
