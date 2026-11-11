import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { RrhhProveedorAdmin } from '../../../../shared/models/rrhh-administracion.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-29 (Administración, prioridad 3) — Proveedores administrativos:
 *  internet, limpieza, seguros de oficina — DISTINTO de compras.proveedores
 *  (material/transporte). */
@Component({
  selector: 'app-rrhh-proveedores',
  imports: [ConfirmDialog, DecimalPipe],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhProveedores implements OnInit {
  private svc = inject(RrhhAdministracionService);
  private toast = inject(ToastService);

  cargando = signal(true);
  proveedores = signal<RrhhProveedorAdmin[]>([]);
  guardando = signal(false);
  mostrarForm = signal(false);
  aEliminar = signal<RrhhProveedorAdmin | null>(null);
  mostrarInactivos = signal(false);

  fNombre = signal('');
  fServicio = signal('');
  fContactoNombre = signal('');
  fContactoTelefono = signal('');
  fContactoEmail = signal('');
  fContratoDesde = signal('');
  fContratoHasta = signal('');
  fMontoMensual = signal('');
  fNotas = signal('');

  formatFecha = formatFechaDisplay;

  visibles = computed(() =>
    this.mostrarInactivos() ? this.proveedores() : this.proveedores().filter((p) => p.activo));

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      this.proveedores.set(await this.svc.listarProveedoresAdmin());
    } catch (e) {
      this.toast.error('No se pudieron cargar los proveedores', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirForm() {
    this.fNombre.set(''); this.fServicio.set(''); this.fContactoNombre.set('');
    this.fContactoTelefono.set(''); this.fContactoEmail.set(''); this.fContratoDesde.set('');
    this.fContratoHasta.set(''); this.fMontoMensual.set(''); this.fNotas.set('');
    this.mostrarForm.set(true);
  }

  async guardar() {
    const nombre = this.fNombre().trim();
    if (!nombre) { this.toast.warning('Falta el nombre', 'Escribe el nombre del proveedor.'); return; }
    this.guardando.set(true);
    try {
      await this.svc.crearProveedorAdmin({
        nombre, servicio: this.fServicio().trim() || null,
        contacto_nombre: this.fContactoNombre().trim() || null,
        contacto_telefono: this.fContactoTelefono().trim() || null,
        contacto_email: this.fContactoEmail().trim() || null,
        contrato_desde: this.fContratoDesde() || null,
        contrato_hasta: this.fContratoHasta() || null,
        monto_mensual: this.fMontoMensual() ? Number(this.fMontoMensual()) : null,
        notas: this.fNotas().trim() || null,
      });
      this.toast.success('Proveedor guardado');
      this.mostrarForm.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  async toggleActivo(p: RrhhProveedorAdmin) {
    try {
      await this.svc.toggleActivoProveedor(p.id, !p.activo);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  pedirEliminar(p: RrhhProveedorAdmin) {
    this.aEliminar.set(p);
  }

  async confirmarEliminar() {
    const p = this.aEliminar();
    if (!p) return;
    try {
      await this.svc.eliminarProveedorAdmin(p.id);
      this.toast.success('Proveedor eliminado');
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.aEliminar.set(null);
    }
  }
}
