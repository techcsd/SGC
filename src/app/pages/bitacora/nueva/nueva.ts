import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ACTIVIDADES,
  Actividad,
  ESTRUCTURAS,
  Estructura,
  RESTRICCIONES,
} from '../../../../shared/models/bitacora.model';
import { todayIso } from '../../../../shared/utils/fecha.util';

const DRAFT_KEY = 'sgc-bitacora-draft';

interface Draft {
  form: Record<string, unknown>;
  actividades: string[];
  restricciones: string[];
}

@Component({
  selector: 'app-bitacora-nueva',
  imports: [ReactiveFormsModule],
  templateUrl: './nueva.html',
  styleUrl: './nueva.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nueva implements OnInit {
  private bitacoraService = inject(BitacoraService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly ESTRUCTURAS = ESTRUCTURAS;
  readonly ACTIVIDADES = ACTIVIDADES;
  readonly RESTRICCIONES = RESTRICCIONES;
  readonly today = todayIso();
  readonly maxArchivos = this.bitacoraService.maxArchivos;

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  saveError = signal('');
  draftAvailable = signal(false);

  actividadesSeleccionadas = signal<Set<string>>(new Set());
  restriccionesSeleccionadas = signal<Set<string>>(new Set());
  archivos = signal<File[]>([]);
  expandedEstructura = signal<Estructura | null>(null);

  form = new FormGroup({
    fecha: new FormControl(this.today, [Validators.required]),
    proyecto_id: new FormControl<string | null>(null, [Validators.required]),
    bloque_entrepiso: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    ingeniero_responsable: new FormControl('', [Validators.required, Validators.maxLength(150)]),
    hora_fin_trabajo: new FormControl('', [Validators.required]),
    personal_carpinteria: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    personal_acero: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    trabajadores_casa: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    otro_personal: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    comentarios: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    descripcion_otro_restriccion: new FormControl<string | null>(null),
  });

  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));
  showOtroRestriccion = computed(() => this.restriccionesSeleccionadas().has('OTRO'));

  async ngOnInit() {
    this.form.controls.ingeniero_responsable.setValue(this.userService.profile()?.nombre ?? '');
    this.draftAvailable.set(sessionStorage.getItem(DRAFT_KEY) !== null);

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.saveDraft());

    try {
      this.proyectos.set(await this.proyectosService.getAll());
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al cargar los proyectos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Draft (sessionStorage) ─────────────────────────────────
  private saveDraft() {
    const draft: Draft = {
      form: this.form.getRawValue(),
      actividades: [...this.actividadesSeleccionadas()],
      restricciones: [...this.restriccionesSeleccionadas()],
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  recuperarDraft() {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const draft = JSON.parse(raw) as Draft;
        this.form.patchValue(draft.form);
        this.actividadesSeleccionadas.set(new Set(draft.actividades));
        this.restriccionesSeleccionadas.set(new Set(draft.restricciones));
      } catch {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    }
    this.draftAvailable.set(false);
  }

  descartarDraft() {
    sessionStorage.removeItem(DRAFT_KEY);
    this.draftAvailable.set(false);
  }

  // ── Actividades matrix ───────────────────────────────────────
  private key(estructura: Estructura, actividad: Actividad): string {
    return `${estructura}|${actividad}`;
  }

  isActividadChecked(estructura: Estructura, actividad: Actividad): boolean {
    return this.actividadesSeleccionadas().has(this.key(estructura, actividad));
  }

  toggleActividad(estructura: Estructura, actividad: Actividad) {
    this.actividadesSeleccionadas.update((set) => {
      const next = new Set(set);
      const k = this.key(estructura, actividad);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    this.saveDraft();
  }

  toggleEstructura(estructura: Estructura) {
    this.expandedEstructura.update((cur) => (cur === estructura ? null : estructura));
  }

  isEstructuraExpanded(estructura: Estructura): boolean {
    return this.expandedEstructura() === estructura;
  }

  countForEstructura(estructura: Estructura): number {
    const prefix = `${estructura}|`;
    return [...this.actividadesSeleccionadas()].filter((k) => k.startsWith(prefix)).length;
  }

  // ── Restricciones ────────────────────────────────────────────
  isRestriccionChecked(value: string): boolean {
    return this.restriccionesSeleccionadas().has(value);
  }

  toggleRestriccion(value: string) {
    this.restriccionesSeleccionadas.update((set) => {
      if (value === 'NINGUNA') {
        return set.has('NINGUNA') ? new Set() : new Set(['NINGUNA']);
      }
      const next = new Set(set);
      next.delete('NINGUNA');
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    this.saveDraft();
  }

  // ── Archivos ─────────────────────────────────────────────────
  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    this.archivos.update((list) => [...list, ...selected].slice(0, this.maxArchivos));
    input.value = '';
  }

  removeArchivo(index: number) {
    this.archivos.update((list) => list.filter((_, i) => i !== index));
  }

  // ── Submit ───────────────────────────────────────────────────
  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;

    if (this.restriccionesSeleccionadas().size === 0) {
      this.saveError.set('Selecciona al menos una restricción ("Ninguna" si no hubo ninguna).');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const v = this.form.getRawValue();
    const actividades = [...this.actividadesSeleccionadas()].map((k) => {
      const [estructura, actividad] = k.split('|') as [Estructura, Actividad];
      return { estructura, actividad };
    });
    const restricciones = [...this.restriccionesSeleccionadas()].map((tipo) => ({
      tipo_restriccion: tipo,
      descripcion_otro: tipo === 'OTRO' ? (v.descripcion_otro_restriccion ?? null) : null,
    }));

    try {
      const usuarioId = this.userService.profile()?.id;
      if (!usuarioId) throw new Error('Sesión inválida. Vuelve a iniciar sesión.');

      const created = await this.bitacoraService.create({
        usuario_id: usuarioId,
        proyecto_id: v.proyecto_id!,
        fecha: v.fecha!,
        bloque_entrepiso: v.bloque_entrepiso!,
        ingeniero_responsable: v.ingeniero_responsable!,
        hora_fin_trabajo: v.hora_fin_trabajo!,
        personal_carpinteria: v.personal_carpinteria!,
        personal_acero: v.personal_acero!,
        trabajadores_casa: v.trabajadores_casa!,
        otro_personal: v.otro_personal ?? null,
        comentarios: v.comentarios ?? null,
        actividades,
        restricciones,
      });

      for (const file of this.archivos()) {
        try {
          await this.bitacoraService.subirArchivo(created.id, file);
        } catch (e: unknown) {
          console.error('Error subiendo archivo:', file.name, e);
        }
      }

      sessionStorage.removeItem(DRAFT_KEY);
      this.router.navigate(['/bitacora/historial']);
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al guardar la bitácora.');
    } finally {
      this.saving.set(false);
    }
  }

  get f() {
    return this.form.controls;
  }
}
