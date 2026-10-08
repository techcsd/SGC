import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApoyoTransporteService, ApoyoRow, ApoyoDetalle, EstadoApoyo, TipoApoyo } from '../../../shared/services/apoyo-transporte.service';
import { ProyectosService, ObraRef } from '../../../shared/services/proyectos.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../../shared/services/toast.service';
import { FormDrawer } from '../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../shared/components/skeleton/skeleton';
import { FileUpload } from '../../../shared/ui/file-upload/file-upload';
import { Lightbox } from '../../../shared/ui/lightbox/lightbox';
import { Icon } from '../../../shared/ui/icon/icon';
import { FilterSelect, FilterOption } from '../../../shared/ui/filter-select/filter-select';
import { formatFechaDisplay, formatFechaHoraDisplay, todayIso } from '../../../shared/utils/fecha.util';

interface TipoDef { value: TipoApoyo; label: string; glosa: string; }

const TIPOS: TipoDef[] = [
  { value: 'movimiento_interno', label: 'Movimiento interno', glosa: 'Mover algo entre obras o al almacén' },
  { value: 'retiro_material', label: 'Retiro de material', glosa: 'Sacar material que sobra o no sirve de la obra' },
  { value: 'bote', label: 'Bote', glosa: 'Llevar escombros/basura de la obra al vertedero' },
];

const ESTADO_LABEL: Record<EstadoApoyo, string> = {
  pendiente: 'Pendiente', asignada: 'Asignada', en_proceso: 'En proceso',
  por_confirmar: 'Por confirmar', completada: 'Completada', cancelada: 'Cancelada',
};

@Component({
  selector: 'app-apoyo-transporte',
  imports: [ReactiveFormsModule, FormDrawer, Skeleton, FileUpload, Lightbox, Icon, FilterSelect],
  templateUrl: './apoyo-transporte.html',
  styleUrl: './apoyo-transporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApoyoTransporte implements OnInit {
  private svc = inject(ApoyoTransporteService);
  private proyectosSvc = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  readonly TIPOS = TIPOS;
  readonly estadoLabel = (e: EstadoApoyo) => ESTADO_LABEL[e] ?? e;
  readonly tipoLabel = (t: TipoApoyo) => TIPOS.find((x) => x.value === t)?.label ?? t;
  readonly fFecha = formatFechaDisplay;
  readonly fHora = formatFechaHoraDisplay;

  esElevado = computed(() => this.userService.esFlotaElevado());
  private miId = computed(() => this.userService.profile()?.id ?? null);

  loading = signal(true);
  rows = signal<ApoyoRow[]>([]);
  obras = signal<ObraRef[]>([]);

  // Filtros
  filtroTipo = signal<string>('');
  filtroEstado = signal<string>('');
  filtroObra = signal<string>('');

  tipoOptions: FilterOption[] = TIPOS.map((t) => ({ value: t.value, label: t.label }));
  estadoOptions: FilterOption[] = (Object.keys(ESTADO_LABEL) as EstadoApoyo[]).map((e) => ({ value: e, label: ESTADO_LABEL[e] }));
  obraOptions = computed<FilterOption[]>(() => this.obras().map((o) => ({ value: o.id, label: o.nombre })));

  filtrados = computed(() => {
    const t = this.filtroTipo(), e = this.filtroEstado(), o = this.filtroObra();
    return this.rows().filter((r) =>
      (!t || r.tipo_apoyo === t) && (!e || r.estado === e) && (!o || r.proyecto_id === o));
  });

  // Miniaturas (path → signed url)
  thumbs = signal<Record<string, string>>({});

  // ── Crear ──
  crearOpen = signal(false);
  guardando = signal(false);
  fotos = signal<File[]>([]);
  form = new FormGroup({
    tipo_apoyo: new FormControl<TipoApoyo>('movimiento_interno', { nonNullable: true }),
    proyecto_id: new FormControl<string | null>(null, Validators.required),
    dia: new FormControl<string>(todayIso(), { nonNullable: true }),
    descripcion: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.minLength(3)] }),
    destino_texto: new FormControl<string>('', { nonNullable: true }),
    es_danado: new FormControl<boolean>(false, { nonNullable: true }),
  });

  tipoSel = computed(() => this.form.controls.tipo_apoyo.value);

  // ── Detalle ──
  detalleOpen = signal(false);
  detalle = signal<ApoyoDetalle | null>(null);
  detalleFotos = signal<string[]>([]);
  accionBusy = signal(false);
  lightbox = signal<string | null>(null);
  // Nota para acciones que la piden (cancelar / "no se ha hecho").
  notaAccion = signal<string>('');
  pidiendoNota = signal<null | 'cancelar' | 'reabrir'>(null);

  async ngOnInit() {
    try {
      const [obras] = await Promise.all([this.proyectosSvc.getDirectorio('conduce')]);
      this.obras.set(obras);
      await this.recargar();
    } finally {
      this.loading.set(false);
    }
  }

  async recargar() {
    const rows = await this.svc.listar();
    this.rows.set(rows);
    // Miniaturas de la primera foto.
    const map: Record<string, string> = {};
    await Promise.all(rows.filter((r) => r.foto_path).map(async (r) => {
      map[r.id] = await this.svc.fotoUrl(r.foto_path);
    }));
    this.thumbs.set(map);
  }

  // ── Crear ──
  abrirCrear() {
    this.form.reset({ tipo_apoyo: 'movimiento_interno', proyecto_id: null, dia: todayIso(), descripcion: '', destino_texto: '', es_danado: false });
    this.fotos.set([]);
    this.crearOpen.set(true);
  }
  setTipo(t: TipoApoyo) {
    this.form.controls.tipo_apoyo.setValue(t);
    if (t !== 'retiro_material') this.form.controls.es_danado.setValue(false);
  }
  addFotos(fs: File[]) { this.fotos.update((cur) => [...cur, ...fs].slice(0, 4)); }
  quitarFoto(i: number) { this.fotos.update((cur) => cur.filter((_, idx) => idx !== i)); }

  async guardar() {
    if (this.guardando()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); this.toast.error('Faltan datos', 'Elige la obra y escribe qué hay que mover.'); return; }
    if (this.fotos().length === 0) { this.toast.error('Falta la foto', 'Agrega al menos una foto de lo que se va a mover.'); return; }
    this.guardando.set(true);
    try {
      const v = this.form.getRawValue();
      const id = await this.svc.crear({
        tipo_apoyo: v.tipo_apoyo,
        proyecto_id: v.proyecto_id,
        dia: v.dia,
        descripcion: v.descripcion.trim(),
        destino_texto: v.tipo_apoyo === 'movimiento_interno' ? (v.destino_texto.trim() || null) : null,
        es_danado: v.tipo_apoyo === 'retiro_material' ? v.es_danado : false,
      });
      for (const f of this.fotos()) {
        try { await this.svc.subirFoto(id, f); } catch { /* foto best-effort tras crear */ }
      }
      this.toast.success('Apoyo creado', 'Transporte ya puede verlo y asignarlo.');
      this.crearOpen.set(false);
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo crear', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Detalle ──
  async abrirDetalle(row: ApoyoRow) {
    this.detalleOpen.set(true);
    this.detalle.set(null);
    this.detalleFotos.set([]);
    this.pidiendoNota.set(null);
    this.notaAccion.set('');
    try {
      const d = await this.svc.detalle(row.id);
      this.detalle.set(d);
      const urls = await Promise.all((d.fotos ?? []).map((f) => this.svc.fotoUrl(f.path)));
      this.detalleFotos.set(urls.filter(Boolean));
    } catch (e: unknown) {
      this.toast.error('No se pudo abrir', e instanceof Error ? e.message : undefined);
      this.detalleOpen.set(false);
    }
  }

  /** CK13 — ¿el usuario en sesión es el solicitante (o elevado)? El servidor es la fuente real. */
  puedoGestionar = computed(() => {
    const d = this.detalle();
    if (!d) return false;
    return this.esElevado() || d.solicitante === this.userService.profile()?.nombre;
  });

  async cambiar(estado: EstadoApoyo, nota?: string | null) {
    const d = this.detalle();
    if (!d || this.accionBusy()) return;
    this.accionBusy.set(true);
    try {
      await this.svc.cambiarEstado(d.id, estado, nota ?? null);
      this.toast.success('Listo', 'El estado del apoyo se actualizó.');
      this.pidiendoNota.set(null);
      this.notaAccion.set('');
      await this.abrirDetalle(d);
      await this.recargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo', e instanceof Error ? e.message : undefined);
    } finally {
      this.accionBusy.set(false);
    }
  }

  confirmarConNota(tipo: 'cancelar' | 'reabrir') {
    const nota = this.notaAccion().trim();
    if (!nota) { this.toast.error('Escribe el motivo', 'Indica por qué.'); return; }
    this.cambiar(tipo === 'cancelar' ? 'cancelada' : 'en_proceso', nota);
  }
}
