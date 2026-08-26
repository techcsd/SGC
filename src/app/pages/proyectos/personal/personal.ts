import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PersonalObraService } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { DatosPruebaViewService } from '../../../../shared/services/datos-prueba-view.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Cargo, PersonalObra, NACIONALIDAD_LABEL } from '../../../../shared/models/personal-obra.model';

/** AR1 — Listado de Personal de obra (filtros por obra/cargo/nacionalidad/estado). */
@Component({
  selector: 'app-personal-obra',
  imports: [FormsModule, Skeleton, RouterLink],
  templateUrl: './personal.html',
  styleUrl: './personal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalObraLista implements OnInit {
  private service = inject(PersonalObraService);
  private proyectos = inject(ProyectosService);
  private datosPrueba = inject(DatosPruebaViewService);
  private router = inject(Router);

  readonly nacionalidadLabel = NACIONALIDAD_LABEL;

  personal = signal<PersonalObra[]>([]);
  obras = signal<ObraRef[]>([]);
  cargos = signal<Cargo[]>([]);
  loading = signal(true);
  error = signal('');

  filObra = signal('');
  filCargo = signal('');
  filNacionalidad = signal('');
  filEstado = signal('activo');
  filAsegurado = signal('');   // AV4
  filCuadrilla = signal('');   // AV4
  busqueda = signal('');

  // AV4 — cuadrillas presentes (para el filtro de la vista de control).
  cuadrillas = computed(() =>
    [...new Set(this.personal().map((p) => (p.cuadrilla ?? '').trim()).filter(Boolean))].sort(),
  );

  filtrados = computed(() => {
    const visibles = this.datosPrueba.visibles(this.personal());
    const cargo = this.filCargo();
    const nac = this.filNacionalidad();
    const est = this.filEstado();
    const obra = this.filObra();
    const aseg = this.filAsegurado();
    const cuad = this.filCuadrilla();
    const q = this.busqueda().trim().toLowerCase();
    return visibles.filter((p) => {
      if (obra && p.proyecto_id !== obra) return false;
      if (cargo && p.cargo_id !== cargo) return false;
      if (nac && p.nacionalidad !== nac) return false;
      if (est && p.estado !== est) return false;
      if (aseg && (p.aseguramiento_estado ?? 'desconocido') !== aseg) return false;
      if (cuad && (p.cuadrilla ?? '') !== cuad) return false;
      if (q) {
        const hay = `${p.nombre} ${p.apellido ?? ''} ${p.documento_numero ?? ''} ${p.cargo?.nombre ?? ''} ${p.carnet_numero ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  // AY6 — contadores para los tiles de resumen.
  totalVisibles = computed(() => this.filtrados().length);
  totalActivos = computed(() => this.filtrados().filter((p) => p.estado === 'activo').length);
  obrasDistintas = computed(() => new Set(this.filtrados().map((p) => p.proyecto_id).filter(Boolean)).size);
  conCarnet = computed(() => this.filtrados().filter((p) => !!p.carnet_numero).length);

  // AZ3 — vacío ≠ oculto ≠ error: el estado vacío debe decir la verdad.
  // Cuántos registros existen pero están ocultos SOLO por el filtro de datos de prueba.
  ocultosPrueba = computed(() =>
    this.datosPrueba.verPrueba() ? 0 : this.personal().filter((p) => p.es_prueba).length,
  );
  puedeVerPrueba = computed(() => this.datosPrueba.puedeVerPrueba());
  /** Motivo por el que la lista sale vacía, para pintar el mensaje correcto. */
  motivoVacio = computed<'ninguno' | 'todos_prueba' | 'filtros' | 'sin_datos'>(() => {
    if (this.filtrados().length) return 'ninguno';
    // hay registros no-prueba visibles pero los filtros los excluyen
    if (this.datosPrueba.visibles(this.personal()).length > 0) return 'filtros';
    // todo lo que existe es de prueba y está oculto
    if (this.ocultosPrueba() > 0) return 'todos_prueba';
    return 'sin_datos';
  });

  mostrarPrueba() {
    this.datosPrueba.set(true);
  }

  limpiarFiltros() {
    this.filObra.set('');
    this.filCargo.set('');
    this.filNacionalidad.set('');
    this.filEstado.set('');
    this.filAsegurado.set('');
    this.filCuadrilla.set('');
    this.busqueda.set('');
  }

  /** AY6 — iniciales para el avatar del listado. */
  iniciales(p: PersonalObra): string {
    return `${(p.nombre?.[0] ?? '')}${(p.apellido?.[0] ?? '')}`.toUpperCase() || '?';
  }

  async ngOnInit() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [personal, obras, cargos] = await Promise.all([
        this.service.listar(),
        this.proyectos.getDirectorio(),
        this.service.getCargos(),
      ]);
      this.personal.set(personal);
      this.obras.set(obras);
      this.cargos.set(cargos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el personal.');
    } finally {
      this.loading.set(false);
    }
  }

  registrar() {
    this.router.navigate(['/proyectos/personal/registrar'], {
      queryParams: this.filObra() ? { obra: this.filObra() } : {},
    });
  }

  abrir(p: PersonalObra) {
    this.router.navigate(['/proyectos/personal', p.id]);
  }
}
