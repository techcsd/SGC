import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ObraProduccionService, DirectorioUsuario } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { TareasService } from '../../../../shared/services/tareas.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { PlanTarea, CharlaSeguridad } from '../../../../shared/models/obra-produccion.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { FileUpload } from '../../../../shared/ui/file-upload/file-upload';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

interface BrigadaGrupo {
  brigada: string;
  tareas: PlanTarea[];
}

@Component({
  selector: 'app-obra-plan-dia',
  imports: [ReactiveFormsModule, FormDrawer, FileUpload, Skeleton],
  templateUrl: './plan-dia.html',
  styleUrl: './plan-dia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraPlanDia implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private tareasService = inject(TareasService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  proyectos = signal<Proyecto[]>([]);
  usuarios = signal<DirectorioUsuario[]>([]);
  proyectoId = signal<string>('');
  fecha = signal<string>(todayIso());

  charla = signal<CharlaSeguridad | null>(null);
  tareas = signal<PlanTarea[]>([]);
  loading = signal(false);
  loadingInit = signal(true);
  saving = signal(false);

  charlaOpen = signal(false);
  tareaOpen = signal(false);
  fotosCharla = signal<File[]>([]);

  grupos = computed<BrigadaGrupo[]>(() => {
    const map = new Map<string, PlanTarea[]>();
    for (const t of this.tareas()) {
      const key = t.brigada?.trim() || 'Sin brigada';
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([brigada, tareas]) => ({ brigada, tareas }));
  });

  puedeCargar = computed(() => !!this.proyectoId());

  charlaForm = new FormGroup({
    tema: new FormControl('', [Validators.required]),
    duracion_min: new FormControl<number>(5, [Validators.required, Validators.min(1)]),
    asistentes: new FormControl<number | null>(null),
    notas: new FormControl<string | null>(null),
  });

  tareaForm = new FormGroup({
    titulo: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    brigada: new FormControl<string | null>(null),
    asignado_a: new FormControl<string | null>(null, [Validators.required]),
    prioridad: new FormControl('media', [Validators.required]),
    descripcion: new FormControl<string | null>(null),
  });

  async ngOnInit() {
    try {
      const [proyectos, usuarios] = await Promise.all([
        this.proyectosService.getAll(),
        this.service.getDirectorio(),
      ]);
      this.proyectos.set(proyectos);
      this.usuarios.set(usuarios);
      if (proyectos.length) {
        this.proyectoId.set(proyectos[0].id);
        await this.loadPlan();
      }
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingInit.set(false);
    }
  }

  async onProyectoChange(id: string) {
    this.proyectoId.set(id);
    await this.loadPlan();
  }
  async onFechaChange(f: string) {
    this.fecha.set(f);
    await this.loadPlan();
  }

  async loadPlan() {
    if (!this.proyectoId()) return;
    this.loading.set(true);
    try {
      const plan = await this.service.getPlanDelDia(this.proyectoId(), this.fecha());
      this.charla.set(plan.charla);
      this.tareas.set(plan.tareas ?? []);
    } catch (e: unknown) {
      this.toast.error('Error al cargar el plan', e instanceof Error ? e.message : undefined);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Charla ──
  openCharla() {
    const c = this.charla();
    this.charlaForm.reset({
      tema: c?.tema ?? '',
      duracion_min: c?.duracion_min ?? 5,
      asistentes: c?.asistentes ?? null,
      notas: c?.notas ?? null,
    });
    this.fotosCharla.set([]);
    this.charlaOpen.set(true);
  }
  onFotosAdd(files: File[]) { this.fotosCharla.update((l) => [...l, ...files]); }
  onFotosRemove(i: number) { this.fotosCharla.update((l) => l.filter((_, idx) => idx !== i)); }

  async saveCharla() {
    this.charlaForm.markAllAsTouched();
    if (this.charlaForm.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const paths = this.fotosCharla().length ? await this.service.subirFotos(this.fotosCharla(), 'charla') : [];
      const existentes = this.charla()?.fotos ?? [];
      const v = this.charlaForm.value;
      await this.service.registrarCharla({
        id: this.charla()?.id,
        proyectoId: this.proyectoId(),
        fecha: this.fecha(),
        tema: v.tema!,
        duracionMin: v.duracion_min!,
        notas: v.notas || null,
        asistentes: v.asistentes ?? null,
        fotos: [...existentes, ...paths],
        firmas: this.charla()?.firmas ?? [],
      });
      this.toast.success('Charla de seguridad registrada');
      this.charlaOpen.set(false);
      await this.loadPlan();
    } catch (e: unknown) {
      this.toast.error('No se pudo registrar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Tarea del día ──
  openTarea() {
    this.tareaForm.reset({ prioridad: 'media' });
    this.tareaOpen.set(true);
  }

  async saveTarea() {
    this.tareaForm.markAllAsTouched();
    if (this.tareaForm.invalid || this.saving()) return;
    const userId = this.userService.profile()?.id;
    if (!userId) { this.toast.error('No se pudo identificar el usuario.'); return; }
    this.saving.set(true);
    try {
      const v = this.tareaForm.value;
      await this.tareasService.create({
        titulo: v.titulo!,
        descripcion: v.descripcion || null,
        prioridad: v.prioridad!,
        asignadoA: v.asignado_a!,
        asignadoPor: userId,
        proyectoId: this.proyectoId(),
        fechaLimite: this.fecha(),
        brigada: v.brigada || null,
      });
      this.toast.success('Tarea asignada al día');
      this.tareaOpen.set(false);
      await this.loadPlan();
    } catch (e: unknown) {
      this.toast.error('No se pudo asignar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  estadoBadge(estado: string): string {
    switch (estado) {
      case 'completada': return 'sgc-badge sgc-badge--success';
      case 'en_progreso': return 'sgc-badge sgc-badge--info';
      case 'cancelada': return 'sgc-badge sgc-badge--danger';
      default: return 'sgc-badge sgc-badge--neutral';
    }
  }

  get fC() { return this.charlaForm.controls; }
  get fT() { return this.tareaForm.controls; }
}
