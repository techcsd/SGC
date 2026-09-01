import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { HumanizarEnumPipe } from '../../../../shared/pipes/humanizar-enum.pipe';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ObraProduccionService, DirectorioUsuario } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ObraNC, AccionCorrectiva, ObraIncidente,
  NC_TIPOS, NC_SEVERIDADES, NC_ESTADOS, INCIDENTE_TIPOS, INCIDENTE_ESTADOS,
  NCEstado, NCTipo, IncidenteTipo, IncidenteEstado,
} from '../../../../shared/models/obra-produccion.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { Lightbox } from '../../../../shared/ui/lightbox/lightbox';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';

type Tab = 'nc' | 'incidentes';

@Component({
  selector: 'app-obra-no-conformidades',
  imports: [HumanizarEnumPipe, ReactiveFormsModule, FormDrawer, FileUpload, Lightbox, Skeleton, Icon],
  templateUrl: './no-conformidades.html',
  styleUrl: './no-conformidades.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraNoConformidades implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private toast = inject(ToastService);

  readonly TIPOS = NC_TIPOS;
  readonly SEVERIDADES = NC_SEVERIDADES;
  readonly ESTADOS = NC_ESTADOS;
  readonly INC_TIPOS = INCIDENTE_TIPOS;
  readonly INC_ESTADOS = INCIDENTE_ESTADOS;
  formatFecha = formatFechaDisplay;

  tab = signal<Tab>('nc');
  loading = signal(true);
  error = signal('');

  ncs = signal<ObraNC[]>([]);
  incidentes = signal<ObraIncidente[]>([]);
  acciones = signal<AccionCorrectiva[]>([]); // todas (para vencidas + KPIs)
  proyectos = signal<Proyecto[]>([]);
  usuarios = signal<DirectorioUsuario[]>([]);

  // Filtros
  filtroProyecto = signal<string>('all');
  filtroEstado = signal<string>('abiertas'); // abiertas | vencidas | cerradas | all
  filtroTipo = signal<string>('all');
  search = signal<string>('');

  // ── Mapa origen_id → acciones (para vencidas y timeline) ──
  private accionesPorNc = computed(() => {
    const map = new Map<string, AccionCorrectiva[]>();
    for (const a of this.acciones()) {
      if (a.origen_tipo !== 'nc') continue;
      const arr = map.get(a.origen_id) ?? [];
      arr.push(a);
      map.set(a.origen_id, arr);
    }
    return map;
  });

  ncVencida(nc: ObraNC): boolean {
    if (nc.estado === 'cerrada' || nc.estado === 'verificada') return false;
    const acc = this.accionesPorNc().get(nc.id) ?? [];
    const hoy = todayIso();
    return acc.some((a) => a.estado === 'abierta' && a.fecha_compromiso != null && a.fecha_compromiso < hoy);
  }

  ncsFiltradas = computed(() => {
    const proy = this.filtroProyecto();
    const estado = this.filtroEstado();
    const tipo = this.filtroTipo();
    const q = this.search().toLowerCase().trim();
    return this.ncs().filter((nc) => {
      if (proy !== 'all' && nc.proyecto_id !== proy) return false;
      if (tipo !== 'all' && nc.tipo !== tipo) return false;
      if (estado === 'abiertas' && !(nc.estado === 'abierta' || nc.estado === 'en_correccion')) return false;
      if (estado === 'cerradas' && nc.estado !== 'cerrada') return false;
      if (estado === 'vencidas' && !this.ncVencida(nc)) return false;
      if (q) {
        const hay = (nc.titulo ?? '') + ' ' + nc.descripcion + ' ' + (nc.ubicacion ?? '') + ' ' + (nc.proyecto?.nombre ?? '');
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  });

  incidentesFiltrados = computed(() => {
    const proy = this.filtroProyecto();
    const q = this.search().toLowerCase().trim();
    return this.incidentes().filter((it) => {
      if (proy !== 'all' && it.proyecto_id !== proy) return false;
      if (q) {
        const hay = it.descripcion + ' ' + (it.ubicacion ?? '') + ' ' + (it.proyecto?.nombre ?? '');
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  });

  // ── KPIs ──
  kpiAbiertas = computed(() => this.ncs().filter((n) => n.estado === 'abierta' || n.estado === 'en_correccion').length);
  kpiVencidas = computed(() => this.ncs().filter((n) => this.ncVencida(n)).length);
  kpiCerradas = computed(() => this.ncs().filter((n) => n.estado === 'cerrada').length);
  kpiTiempoCierre = computed(() => {
    const cerradas = this.ncs().filter((n) => n.estado === 'cerrada' && n.cerrada_en && n.created_at);
    if (!cerradas.length) return null;
    const dias = cerradas.map((n) => (new Date(n.cerrada_en!).getTime() - new Date(n.created_at!).getTime()) / 86400000);
    return Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10;
  });
  kpiIncidentesAbiertos = computed(() => this.incidentes().filter((i) => i.estado !== 'cerrado').length);

  // ── Drawers / forms ──
  createNCOpen = signal(false);
  createIncOpen = signal(false);
  detailOpen = signal(false);
  assignOpen = signal(false);
  saving = signal(false);

  detailNC = signal<ObraNC | null>(null);
  detailAcciones = signal<AccionCorrectiva[]>([]);

  fotosNC = signal<File[]>([]);
  fotosInc = signal<File[]>([]);
  fotosAccion = signal<File[]>([]);
  lightbox = signal<string | null>(null);

  ncForm = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<NCTipo | null>('calidad', [Validators.required]),
    titulo: new FormControl<string | null>(null),
    descripcion: new FormControl('', [Validators.required, Validators.maxLength(1000)]),
    severidad: new FormControl('media', [Validators.required]),
    ubicacion: new FormControl<string | null>(null),
    responsable_id: new FormControl<string | null>(null),
    bloquea_vaciado: new FormControl<boolean>(false),
  });

  incForm = new FormGroup({
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    tipo: new FormControl<IncidenteTipo>('casi_accidente', [Validators.required]),
    gravedad: new FormControl('media', [Validators.required]),
    descripcion: new FormControl('', [Validators.required]),
    lesionados: new FormControl<number>(0, [Validators.min(0)]),
    ubicacion: new FormControl<string | null>(null),
    investigacion: new FormControl<string | null>(null),
    fecha: new FormControl<string>(todayIso(), [Validators.required]),
  });

  assignForm = new FormGroup({
    descripcion: new FormControl('', [Validators.required]),
    responsable_id: new FormControl<string | null>(null),
    fecha_compromiso: new FormControl<string | null>(null),
  });

  async ngOnInit() {
    await this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [ncs, incidentes, proyectos, usuarios, acciones] = await Promise.all([
        this.service.getNoConformidades(),
        this.service.getIncidentes(),
        this.proyectosService.getAll(),
        this.service.getDirectorio(),
        this.service.getAccionesTodas(),
      ]);
      this.ncs.set(ncs);
      this.incidentes.set(incidentes);
      this.proyectos.set(proyectos);
      this.usuarios.set(usuarios);
      this.acciones.set(acciones);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Error al cargar.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(t: Tab) { this.tab.set(t); }

  clearFilters() {
    this.filtroProyecto.set('all');
    this.filtroEstado.set('abiertas');
    this.filtroTipo.set('all');
    this.search.set('');
  }

  // ── Crear NC ──
  openCreateNC() {
    this.ncForm.reset({ tipo: 'calidad', severidad: 'media', bloquea_vaciado: false });
    this.fotosNC.set([]);
    this.createNCOpen.set(true);
  }
  onFotosNCAdd(files: File[]) { this.fotosNC.update((l) => [...l, ...files]); }
  onFotosNCRemove(i: number) { this.fotosNC.update((l) => l.filter((_, idx) => idx !== i)); }

  async saveNC() {
    this.ncForm.markAllAsTouched();
    if (this.ncForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const paths = this.fotosNC().length ? await this.service.subirFotos(this.fotosNC(), 'nc') : [];
      const v = this.ncForm.value;
      await this.service.levantarNC(
        {
          proyecto_id: v.proyecto_id!,
          tipo: v.tipo ?? null,
          titulo: v.titulo || null,
          descripcion: v.descripcion!,
          severidad: v.severidad as never,
          ubicacion: v.ubicacion || null,
          responsable_id: v.responsable_id || null,
          bloquea_vaciado: !!v.bloquea_vaciado,
        },
        paths,
      );
      this.toast.success('No conformidad registrada');
      this.createNCOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('No se pudo registrar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Detalle NC + acciones ──
  async openDetail(nc: ObraNC) {
    this.detailNC.set(nc);
    this.detailOpen.set(true);
    this.detailAcciones.set([]);
    try {
      this.detailAcciones.set(await this.service.getAcciones('nc', nc.id));
    } catch { /* ignore */ }
  }
  closeDetail() { this.detailOpen.set(false); }

  openAssign() {
    this.assignForm.reset({ descripcion: '', responsable_id: null, fecha_compromiso: null });
    this.assignOpen.set(true);
  }

  async saveAssign() {
    this.assignForm.markAllAsTouched();
    const nc = this.detailNC();
    if (!nc || this.assignForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.assignForm.value;
      await this.service.asignarAccion({
        proyectoId: nc.proyecto_id,
        origenTipo: 'nc',
        origenId: nc.id,
        descripcion: v.descripcion!,
        responsableId: v.responsable_id || null,
        fechaCompromiso: v.fecha_compromiso || null,
      });
      this.toast.success('Acción correctiva asignada');
      this.assignOpen.set(false);
      this.detailAcciones.set(await this.service.getAcciones('nc', nc.id));
      await this.refreshLists();
    } catch (e: unknown) {
      this.toast.error('No se pudo asignar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async marcarHecha(a: AccionCorrectiva) {
    try {
      await this.service.marcarAccionHecha(a.id, a.evidencia_fotos ?? []);
      const nc = this.detailNC();
      if (nc) this.detailAcciones.set(await this.service.getAcciones('nc', nc.id));
      await this.refreshLists();
      this.toast.success('Acción marcada como hecha');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  async verificarCerrar() {
    const nc = this.detailNC();
    if (!nc || this.saving()) return;
    this.saving.set(true);
    try {
      await this.service.verificarCerrarNC(nc.id);
      this.toast.success('No conformidad verificada y cerrada');
      this.detailOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('No se pudo cerrar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Incidentes ──
  openCreateInc() {
    this.incForm.reset({ tipo: 'casi_accidente', gravedad: 'media', lesionados: 0, fecha: todayIso() });
    this.fotosInc.set([]);
    this.createIncOpen.set(true);
  }
  onFotosIncAdd(files: File[]) { this.fotosInc.update((l) => [...l, ...files]); }
  onFotosIncRemove(i: number) { this.fotosInc.update((l) => l.filter((_, idx) => idx !== i)); }

  async saveInc() {
    this.incForm.markAllAsTouched();
    if (this.incForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const paths = this.fotosInc().length ? await this.service.subirFotos(this.fotosInc(), 'incidente') : [];
      const v = this.incForm.value;
      await this.service.registrarIncidente(
        {
          proyecto_id: v.proyecto_id!,
          tipo: v.tipo!,
          gravedad: v.gravedad as never,
          descripcion: v.descripcion!,
          lesionados: v.lesionados ?? 0,
          ubicacion: v.ubicacion || null,
          investigacion: v.investigacion || null,
          fecha: v.fecha!,
        },
        paths,
      );
      this.toast.success('Incidente registrado');
      this.createIncOpen.set(false);
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('No se pudo registrar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async cerrarIncidente(it: ObraIncidente) {
    try {
      await this.service.cerrarIncidente(it.id);
      this.toast.success('Incidente cerrado');
      await this.loadAll();
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    }
  }

  private async refreshLists() {
    try {
      const [ncs, acciones] = await Promise.all([
        this.service.getNoConformidades(),
        this.service.getAccionesTodas(),
      ]);
      this.ncs.set(ncs);
      this.acciones.set(acciones);
    } catch { /* ignore */ }
  }

  // ── Foto lightbox ──
  async verFoto(path: string) {
    const url = await this.service.signedUrl(path);
    if (url) this.lightbox.set(url);
  }

  // ── Labels / badges ──
  tipoLabel(t: NCTipo | null): string { return this.TIPOS.find((x) => x.value === t)?.label ?? '—'; }
  sevBadge(s: string): string { return 'sgc-badge sgc-badge--' + (this.SEVERIDADES.find((x) => x.value === s)?.badge ?? 'neutral'); }
  estadoBadge(e: NCEstado): string { return 'sgc-badge sgc-badge--' + (this.ESTADOS.find((x) => x.value === e)?.badge ?? 'neutral'); }
  estadoLabel(e: NCEstado): string { return this.ESTADOS.find((x) => x.value === e)?.label ?? e; }
  incTipoLabel(t: IncidenteTipo): string { return this.INC_TIPOS.find((x) => x.value === t)?.label ?? t; }
  incEstadoBadge(e: IncidenteEstado): string { return 'sgc-badge sgc-badge--' + (this.INC_ESTADOS.find((x) => x.value === e)?.badge ?? 'neutral'); }
  incEstadoLabel(e: IncidenteEstado): string { return this.INC_ESTADOS.find((x) => x.value === e)?.label ?? e; }
  proyectoNombre(id: string): string { return this.proyectos().find((p) => p.id === id)?.nombre ?? '—'; }
  usuarioNombre(id: string | null): string { return id ? (this.usuarios().find((u) => u.id === id)?.nombre ?? '—') : '—'; }

  get fNC() { return this.ncForm.controls; }
  get fInc() { return this.incForm.controls; }
  get fAsg() { return this.assignForm.controls; }
}
