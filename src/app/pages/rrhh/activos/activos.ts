import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { ActivoCategoria, ActivoEstado, RrhhActivo } from '../../../../shared/models/rrhh-administracion.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
/** DN-29 (Administración, prioridad 4) — Activos y oficina: mobiliario,
 *  suministros y mantenimiento del local — DISTINTO del inventario
 *  tecnológico (equipos de cómputo, ver Tecnología › Inventario). */
@Component({
  selector: 'app-rrhh-activos',
  imports: [ConfirmDialog, DecimalPipe, TranslatePipe],
  templateUrl: './activos.html',
  styleUrl: './activos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhActivos implements OnInit {
  private svc = inject(RrhhAdministracionService);
  private toast = inject(ToastService);
  protected i18n = inject(I18nService);

  cargando = signal(true);
  activos = signal<RrhhActivo[]>([]);
  guardando = signal(false);
  mostrarForm = signal(false);
  aEliminar = signal<RrhhActivo | null>(null);

  fNombre = signal('');
  fCategoria = signal<ActivoCategoria>('mobiliario');
  fUbicacion = signal('');
  fFechaAdquisicion = signal('');
  fValor = signal('');
  fProximoMantenimiento = signal('');
  fNotas = signal('');

  formatFecha = formatFechaDisplay;

  requierenAtencion = computed(() =>
    this.activos().filter((a) => a.estado === 'mantenimiento' || a.estado === 'baja'));
  resto = computed(() => {
    const ids = new Set(this.requierenAtencion().map((a) => a.id));
    return this.activos().filter((a) => !ids.has(a.id));
  });

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      this.activos.set(await this.svc.listarActivos());
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudieron cargar los activos'), e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirForm() {
    this.fNombre.set(''); this.fCategoria.set('mobiliario'); this.fUbicacion.set('');
    this.fFechaAdquisicion.set(''); this.fValor.set(''); this.fProximoMantenimiento.set(''); this.fNotas.set('');
    this.mostrarForm.set(true);
  }

  async guardar() {
    const nombre = this.fNombre().trim();
    if (!nombre) { this.toast.warning(this.i18n.t('Falta el nombre'), 'Escribe qué es el activo.'); return; }
    this.guardando.set(true);
    try {
      await this.svc.crearActivo({
        nombre, categoria: this.fCategoria(), ubicacion: this.fUbicacion().trim() || null,
        fecha_adquisicion: this.fFechaAdquisicion() || null,
        valor: this.fValor() ? Number(this.fValor()) : null,
        proximo_mantenimiento: this.fProximoMantenimiento() || null,
        notas: this.fNotas().trim() || null,
      });
      this.toast.success(this.i18n.t('Activo guardado'));
      this.mostrarForm.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar'), e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  async cambiarEstado(a: RrhhActivo, estado: ActivoEstado) {
    try {
      await this.svc.actualizarEstadoActivo(a.id, estado);
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo actualizar'), e instanceof Error ? e.message : undefined);
    }
  }

  pedirEliminar(a: RrhhActivo) {
    this.aEliminar.set(a);
  }

  async confirmarEliminar() {
    const a = this.aEliminar();
    if (!a) return;
    try {
      await this.svc.eliminarActivo(a.id);
      this.toast.success(this.i18n.t('Activo eliminado'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo eliminar'), e instanceof Error ? e.message : undefined);
    } finally {
      this.aEliminar.set(null);
    }
  }
}
