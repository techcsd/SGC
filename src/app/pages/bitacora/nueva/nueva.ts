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
import { FormControl, FormGroup, ReactiveFormsModule, Validators, ValidatorFn } from '@angular/forms';
import { Router } from '@angular/router';
import { BitacoraService } from '../../../../shared/services/bitacora.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { BitacoraCatalogosService } from '../../../../shared/services/bitacora-catalogos.service';
import { UserService } from '../../../core/services/user.service';
import { ContextService } from '../../../../shared/context/context.service';
import { WeatherService } from '../../../../shared/context/weather.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import {
  ACTIVIDADES,
  ESTRUCTURAS,
  RESTRICCIONES,
  BITACORA_TIPOS,
  BitacoraTipo,
  VISITANTE_TIPOS,
  INCIDENTE_TIPOS,
  INCIDENTE_GRAVEDADES,
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
  private contextService = inject(ContextService);
  private weatherService = inject(WeatherService);
  private catalogosService = inject(BitacoraCatalogosService);

  // Default to the built-in lists, then override with the admin-managed catalog.
  estructuras = signal<readonly string[]>(ESTRUCTURAS);
  actividades = signal<readonly string[]>(ACTIVIDADES);
  restricciones = signal<{ value: string; label: string }[]>(RESTRICCIONES);
  readonly TIPOS = BITACORA_TIPOS;
  readonly VISITANTE_TIPOS = VISITANTE_TIPOS;
  readonly INCIDENTE_TIPOS = INCIDENTE_TIPOS;
  readonly INCIDENTE_GRAVEDADES = INCIDENTE_GRAVEDADES;
  readonly today = todayIso();
  readonly maxArchivos = this.bitacoraService.maxArchivos;

  proyectos = signal<Proyecto[]>([]);
  loading = signal(true);
  saving = signal(false);
  saveError = signal('');
  draftAvailable = signal(false);

  tipoActual = signal<BitacoraTipo>('parte_diario');

  actividadesSeleccionadas = signal<Set<string>>(new Set());
  restriccionesSeleccionadas = signal<Set<string>>(new Set());
  archivos = signal<File[]>([]);
  expandedEstructura = signal<string | null>(null);

  // Daily-log controls carry required validators toggled off for visita/incidente.
  private readonly PARTE_CONTROLS = [
    'bloque_entrepiso',
    'ingeniero_responsable',
    'hora_fin_trabajo',
    'personal_carpinteria',
    'personal_acero',
    'trabajadores_casa',
  ] as const;

  form = new FormGroup({
    tipo: new FormControl<BitacoraTipo>('parte_diario', [Validators.required]),
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
    // Visita
    visita_tipo_visitante: new FormControl<string | null>(null),
    visita_nombre: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    visita_organizacion: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    visita_motivo: new FormControl<string | null>(null, [Validators.maxLength(500)]),
    // Incidente
    incidente_tipo: new FormControl<string | null>(null),
    incidente_gravedad: new FormControl<string | null>(null),
    incidente_subcontratista: new FormControl<string | null>(null, [Validators.maxLength(150)]),
    incidente_lesionados: new FormControl<number | null>(0, [Validators.min(0)]),
    incidente_descripcion: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
    incidente_acciones: new FormControl<string | null>(null, [Validators.maxLength(2000)]),
  });

  activeProyectos = computed(() => this.proyectos().filter((p) => p.activo));
  showOtroRestriccion = computed(() => this.restriccionesSeleccionadas().has('OTRO'));

  /** Toggle required validators to match the selected entry type. */
  onTipoChange(tipo: BitacoraTipo) {
    this.tipoActual.set(tipo);

    const numericos = ['personal_carpinteria', 'personal_acero', 'trabajadores_casa'];
    for (const name of this.PARTE_CONTROLS) {
      const ctrl = this.form.get(name)!;
      if (tipo === 'parte_diario') {
        ctrl.setValidators(numericos.includes(name) ? [Validators.required, Validators.min(0)] : [Validators.required]);
      } else {
        ctrl.clearValidators();
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    }

    const setReq = (name: string, required: boolean, extra: ValidatorFn[] = []) => {
      const ctrl = this.form.get(name)!;
      ctrl.setValidators(required ? [Validators.required, ...extra] : extra);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };

    setReq('visita_tipo_visitante', tipo === 'visita');
    setReq('visita_nombre', tipo === 'visita', [Validators.maxLength(150)]);
    setReq('incidente_tipo', tipo === 'incidente');
    setReq('incidente_gravedad', tipo === 'incidente');
    setReq('incidente_descripcion', tipo === 'incidente', [Validators.maxLength(2000)]);
  }

  async ngOnInit() {
    this.form.controls.ingeniero_responsable.setValue(this.userService.profile()?.nombre ?? '');
    this.draftAvailable.set(sessionStorage.getItem(DRAFT_KEY) !== null);

    this.form.controls.tipo.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((t) => this.onTipoChange((t ?? 'parte_diario') as BitacoraTipo));

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.saveDraft());

    try {
      this.proyectos.set(await this.proyectosService.getAll());
    } catch (e: unknown) {
      this.saveError.set(e instanceof Error ? e.message : 'Error al cargar los proyectos.');
    } finally {
      this.loading.set(false);
    }

    // Override the built-in lists with the admin-managed catalog (best-effort).
    try {
      const cat = await this.catalogosService.getCatalogos();
      if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
      if (cat.actividades.length) this.actividades.set(cat.actividades);
      if (cat.restricciones.length) this.restricciones.set(cat.restricciones);
    } catch {
      /* keep the built-in lists */
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
  private key(estructura: string, actividad: string): string {
    return `${estructura}|${actividad}`;
  }

  isActividadChecked(estructura: string, actividad: string): boolean {
    return this.actividadesSeleccionadas().has(this.key(estructura, actividad));
  }

  toggleActividad(estructura: string, actividad: string) {
    this.actividadesSeleccionadas.update((set) => {
      const next = new Set(set);
      const k = this.key(estructura, actividad);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    this.saveDraft();
  }

  toggleEstructura(estructura: string) {
    this.expandedEstructura.update((cur) => (cur === estructura ? null : estructura));
  }

  isEstructuraExpanded(estructura: string): boolean {
    return this.expandedEstructura() === estructura;
  }

  countForEstructura(estructura: string): number {
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

    const tipo = this.tipoActual();

    if (tipo === 'parte_diario' && this.restriccionesSeleccionadas().size === 0) {
      this.saveError.set('Selecciona al menos una restricción ("Ninguna" si no hubo ninguna).');
      return;
    }

    this.saving.set(true);
    this.saveError.set('');

    const v = this.form.getRawValue();
    const esParte = tipo === 'parte_diario';
    const actividades = esParte
      ? [...this.actividadesSeleccionadas()].map((k) => {
          const [estructura, actividad] = k.split('|') as [string, string];
          return { estructura, actividad };
        })
      : [];
    const restricciones = esParte
      ? [...this.restriccionesSeleccionadas()].map((r) => ({
          tipo_restriccion: r,
          descripcion_otro: r === 'OTRO' ? (v.descripcion_otro_restriccion ?? null) : null,
        }))
      : [];

    try {
      const usuarioId = this.userService.profile()?.id;
      if (!usuarioId) throw new Error('Sesión inválida. Vuelve a iniciar sesión.');

      // Auto-capture the weather at the obra when the project has coordinates,
      // so every entry carries its climate context with no manual input.
      let weatherSnapshotId: string | null = null;
      const proyecto = this.proyectos().find((p) => p.id === v.proyecto_id);
      if (proyecto?.latitud != null && proyecto.longitud != null) {
        try {
          const coords = { latitud: proyecto.latitud, longitud: proyecto.longitud };
          const ctx = await this.contextService.getContexto(coords);
          weatherSnapshotId = await this.weatherService.guardarSnapshot(coords, ctx.pronostico.actual, proyecto.id);
        } catch {
          // Weather capture is best-effort; never block saving the bitácora.
        }
      }

      const created = await this.bitacoraService.create({
        usuario_id: usuarioId,
        proyecto_id: v.proyecto_id!,
        fecha: v.fecha!,
        tipo,
        comentarios: v.comentarios ?? null,
        bloque_entrepiso: esParte ? v.bloque_entrepiso! : null,
        ingeniero_responsable: esParte ? v.ingeniero_responsable! : null,
        hora_fin_trabajo: esParte ? v.hora_fin_trabajo! : null,
        personal_carpinteria: esParte ? v.personal_carpinteria! : 0,
        personal_acero: esParte ? v.personal_acero! : 0,
        trabajadores_casa: esParte ? v.trabajadores_casa! : 0,
        otro_personal: esParte ? (v.otro_personal ?? null) : null,
        actividades,
        restricciones,
        visita_tipo_visitante: tipo === 'visita' ? (v.visita_tipo_visitante ?? null) : null,
        visita_nombre: tipo === 'visita' ? (v.visita_nombre ?? null) : null,
        visita_organizacion: tipo === 'visita' ? (v.visita_organizacion ?? null) : null,
        visita_motivo: tipo === 'visita' ? (v.visita_motivo ?? null) : null,
        incidente_tipo: tipo === 'incidente' ? (v.incidente_tipo ?? null) : null,
        incidente_gravedad: tipo === 'incidente' ? (v.incidente_gravedad ?? null) : null,
        incidente_subcontratista: tipo === 'incidente' ? (v.incidente_subcontratista ?? null) : null,
        incidente_lesionados: tipo === 'incidente' ? (v.incidente_lesionados ?? 0) : 0,
        incidente_descripcion: tipo === 'incidente' ? (v.incidente_descripcion ?? null) : null,
        incidente_acciones: tipo === 'incidente' ? (v.incidente_acciones ?? null) : null,
        weather_snapshot_id: weatherSnapshotId,
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
