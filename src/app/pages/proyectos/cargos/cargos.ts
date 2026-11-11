import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersonalObraService, CargoAlias } from '../../../../shared/services/personal-obra.service';
import { Cargo } from '../../../../shared/models/personal-obra.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { Icon } from '../../../../shared/ui/icon/icon';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * CG2 — Proyectos › Cargos. Catálogo de cargos (lectura) + gestor de alias:
 * los textos sucios del Excel de personal ("CAPATAZ CSD", "AYUDANTE DE CARPINTERO"…)
 * se mapean a un cargo del catálogo para que el importador los reconozca siempre.
 * El importador también los aprende solo; aquí se auditan/corrigen a mano.
 * DN-24 — una fila abre un panel de detalle (alias editables de ese cargo +
 * cuántas personas de obra lo tienen + cuándo se agregó cada alias).
 */
@Component({
  selector: 'app-proyectos-cargos',
  imports: [RouterLink, Icon, FormDrawer, ConfirmDialog],
  templateUrl: './cargos.html',
  styleUrl: './cargos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProyectosCargos implements OnInit {
  private svc = inject(PersonalObraService);
  private toast = inject(ToastService);

  cargos = signal<Cargo[]>([]);
  aliases = signal<CargoAlias[]>([]);
  cargando = signal(true);
  error = signal('');

  // Formulario de alta de alias (catálogo general, fuera del detalle).
  nuevoAlias = signal('');
  nuevoCargoId = signal('');
  guardando = signal(false);

  // Conteo de alias por cargo (para la columna del catálogo).
  aliasPorCargo = computed(() => {
    const m = new Map<string, number>();
    for (const a of this.aliases()) m.set(a.cargo_id, (m.get(a.cargo_id) ?? 0) + 1);
    return m;
  });

  // ── DN-24 — panel de detalle de un cargo ─────────────────────────────────
  seleccionado = signal<Cargo | null>(null);
  personasDelCargo = signal<number | null>(null);
  cargandoPersonas = signal(false);
  aliasesDelSeleccionado = computed(() => {
    const id = this.seleccionado()?.id;
    if (!id) return [];
    return this.aliases().filter((a) => a.cargo_id === id);
  });
  nuevoAliasDetalle = signal('');
  guardandoDetalle = signal(false);
  aliasAEliminar = signal<CargoAlias | null>(null);
  formatFecha = formatFechaDisplay;

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [cargos, aliases] = await Promise.all([this.svc.getCargos(), this.svc.listarCargoAlias()]);
      this.cargos.set(cargos);
      this.aliases.set(aliases.sort((a, b) =>
        (a.cargo_nombre ?? '').localeCompare(b.cargo_nombre ?? '') ||
        a.alias_normalizado.localeCompare(b.alias_normalizado)));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar los cargos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async agregarAlias() {
    const alias = this.nuevoAlias().trim();
    const cargoId = this.nuevoCargoId();
    if (!alias || !cargoId) {
      this.toast.warning('Faltan datos', 'Escribe el texto y elige a qué cargo se mapea.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.svc.registrarCargoAlias(alias, cargoId);
      this.nuevoAlias.set('');
      this.nuevoCargoId.set('');
      await this.cargar();
      this.toast.success('Alias agregado', `«${alias}» ahora se reconoce al importar.`);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  /** DN-25 (regla 16) — sin `confirm()` nativo: abre el diálogo propio del SGC. */
  pedirEliminarAlias(a: CargoAlias) {
    this.aliasAEliminar.set(a);
  }

  async confirmarEliminarAlias() {
    const a = this.aliasAEliminar();
    if (!a) return;
    try {
      await this.svc.eliminarCargoAlias(a.id);
      this.aliases.update((xs) => xs.filter((x) => x.id !== a.id));
      this.toast.success('Alias eliminado');
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.aliasAEliminar.set(null);
    }
  }

  // Mantiene la firma vieja para la fila del catálogo (redirige al diálogo).
  eliminarAlias(a: CargoAlias) {
    this.pedirEliminarAlias(a);
  }

  // ── DN-24 — panel de detalle de un cargo ─────────────────────────────────
  abrirDetalle(c: Cargo) {
    this.seleccionado.set(c);
    this.nuevoAliasDetalle.set('');
    void this.cargarPersonasDelCargo(c.id);
  }

  cerrarDetalle() {
    this.seleccionado.set(null);
    this.personasDelCargo.set(null);
  }

  /** Enter/Space sobre una fila del catálogo también abre el detalle (DN-24: accesible por teclado). */
  onFilaKeydown(ev: KeyboardEvent, c: Cargo) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.abrirDetalle(c);
    }
  }

  private async cargarPersonasDelCargo(cargoId: string) {
    this.cargandoPersonas.set(true);
    try {
      this.personasDelCargo.set(await this.svc.contarPersonalPorCargo(cargoId));
    } catch {
      this.personasDelCargo.set(null);
    } finally {
      this.cargandoPersonas.set(false);
    }
  }

  async agregarAliasAlSeleccionado() {
    const cargo = this.seleccionado();
    const alias = this.nuevoAliasDetalle().trim();
    if (!cargo || !alias) return;
    this.guardandoDetalle.set(true);
    try {
      await this.svc.registrarCargoAlias(alias, cargo.id);
      this.nuevoAliasDetalle.set('');
      await this.cargar();
      this.toast.success('Alias agregado', `«${alias}» ahora se reconoce al importar.`);
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoDetalle.set(false);
    }
  }
}
