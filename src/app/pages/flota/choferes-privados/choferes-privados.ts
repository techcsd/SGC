import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FlotaSubnav } from '../flota-subnav/flota-subnav';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';
import { Icon } from '../../../../shared/ui/icon/icon';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { ChoferesPrivadosService, ChoferPrivado } from '../../../../shared/services/choferes-privados.service';
import { VehiculosService } from '../../../../shared/services/vehiculos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Vehiculo } from '../../../../shared/models/vehiculo.model';
import { formatearCedula } from '../../../../shared/utils/cedula.util';
import { formatearTelefono } from '../../../../shared/utils/telefono.util';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/**
 * CJ12 — Flota › Choferes privados. Lista los usuarios con rol chofer_privado, sus
 * vehículos autorizados (chips con vigencia), el vehículo en uso ahora y el último uso.
 * Permite autorizar varios vehículos de una vez, retirar una autorización, y agregar
 * un chofer privado (asigna el rol a un usuario existente). Gate: flota elevado.
 */
@Component({
  selector: 'app-choferes-privados',
  imports: [FormsModule, RouterLink, FlotaSubnav, FormDrawer, Skeleton, Icon, UserPicker],
  templateUrl: './choferes-privados.html',
  styleUrl: './choferes-privados.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChoferesPrivados implements OnInit {
  private service = inject(ChoferesPrivadosService);
  private vehiculosService = inject(VehiculosService);
  private toast = inject(ToastService);

  readonly fmtCedula = formatearCedula;
  readonly fmtTelefono = formatearTelefono;
  readonly fmtFecha = formatFechaDisplay;

  cargando = signal(true);
  choferes = signal<ChoferPrivado[]>([]);
  vehiculos = signal<Vehiculo[]>([]);

  // Drawer de autorización
  autOpen = signal(false);
  autChofer = signal<ChoferPrivado | null>(null);
  autSeleccion = signal<Set<string>>(new Set());
  autDesde = signal<string>('');
  autHasta = signal<string>('');
  autNota = signal<string>('');
  autGuardando = signal(false);

  // Drawer de agregar
  addOpen = signal(false);
  addUsuario = signal<UserPickerSelection | null>(null);
  addGuardando = signal(false);

  /** Vehículos activos que el chofer en foco aún no tiene autorizados. */
  vehiculosDisponibles = computed(() => {
    const ch = this.autChofer();
    const yaAut = new Set((ch?.autorizadas ?? []).map((a) => a.vehiculo_id));
    return this.vehiculos().filter((v) => v.activo && !yaAut.has(v.id));
  });

  async ngOnInit() {
    await this.cargar();
    try {
      this.vehiculos.set(await this.vehiculosService.getAll());
    } catch { /* la lista de autorizar quedará vacía; se reintenta al abrir */ }
  }

  async cargar() {
    this.cargando.set(true);
    try {
      this.choferes.set(await this.service.listar());
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudieron cargar los choferes privados');
    } finally {
      this.cargando.set(false);
    }
  }

  // ── Autorizar ──────────────────────────────────────────────────────────────
  abrirAutorizar(ch: ChoferPrivado) {
    this.autChofer.set(ch);
    this.autSeleccion.set(new Set());
    this.autDesde.set('');
    this.autHasta.set('');
    this.autNota.set('');
    this.autOpen.set(true);
  }

  toggleVehiculo(id: string) {
    const s = new Set(this.autSeleccion());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.autSeleccion.set(s);
  }

  async guardarAutorizacion() {
    const ch = this.autChofer();
    const ids = [...this.autSeleccion()];
    if (!ch || !ids.length) return;
    this.autGuardando.set(true);
    try {
      const n = await this.service.autorizarLote(
        ch.usuario_id, ids, this.autDesde() || null, this.autHasta() || null, this.autNota().trim() || null);
      this.toast.success('Listo', `Autorizaste ${n} vehículo${n !== 1 ? 's' : ''} a ${ch.nombre}.`);
      this.autOpen.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo autorizar');
    } finally {
      this.autGuardando.set(false);
    }
  }

  async retirar(ch: ChoferPrivado, autorizacionId: string, placa: string | null) {
    if (!window.confirm(`¿Retirar la autorización del vehículo ${placa ?? ''} a ${ch.nombre}?`)) return;
    try {
      await this.service.retirar(autorizacionId);
      this.toast.success('Retirada', 'La autorización se retiró.');
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo retirar');
    }
  }

  // ── Agregar chofer privado ──────────────────────────────────────────────────
  abrirAgregar() {
    this.addUsuario.set(null);
    this.addOpen.set(true);
  }

  async guardarAgregar() {
    const sel = this.addUsuario();
    if (!sel?.usuario_id) return;
    this.addGuardando.set(true);
    try {
      await this.service.hacerPrivado(sel.usuario_id);
      this.toast.success('Listo', `${sel.nombre} ahora es chofer privado.`);
      this.addOpen.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo asignar el rol');
    } finally {
      this.addGuardando.set(false);
    }
  }
}
