import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TransporteV3Service, ProveedorTransporte, ViajeProveedor } from '../../../../shared/services/transporte-v3.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

/**
 * BA / Transporte v3 — catálogo de proveedores de transporte + bandeja de
 * ratificación (Raykler/Logística) + perfil (viajes del mes, pagado/no pagado).
 */
@Component({
  selector: 'app-proveedores-transporte',
  imports: [DatePipe, Skeleton],
  templateUrl: './proveedores-transporte.html',
  styleUrl: './proveedores-transporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresTransporte {
  private svc = inject(TransporteV3Service);
  private user = inject(UserService);
  private toast = inject(ToastService);

  // Mirror de sgc.es_logistica(): admin O rol logística.
  esLogistica = computed(() => this.user.hasRole('admin') || this.user.hasRole('logistica'));

  proveedores = signal<ProveedorTransporte[]>([]);
  loading = signal(true);
  tab = signal<'todos' | 'por_ratificar'>('todos');

  // Perfil desplegado
  abierto = signal<string | null>(null);
  viajes = signal<ViajeProveedor[]>([]);
  cargandoViajes = signal(false);

  // Alta rápida
  nuevoNombre = signal('');
  nuevoTel = signal('');

  filtrados = computed(() =>
    this.tab() === 'por_ratificar'
      ? this.proveedores().filter((p) => p.estado === 'sin_ratificar')
      : this.proveedores(),
  );

  async ngOnInit() {
    await this.recargar();
  }

  async recargar() {
    this.loading.set(true);
    try {
      this.proveedores.set(await this.svc.proveedores());
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudieron cargar los proveedores');
    } finally {
      this.loading.set(false);
    }
  }

  async crear() {
    const nombre = this.nuevoNombre().trim();
    if (!nombre) { this.toast.warning('Escribe el nombre'); return; }
    try {
      await this.svc.crearProveedor({ nombre, telefono: this.nuevoTel().trim() || null });
      this.nuevoNombre.set(''); this.nuevoTel.set('');
      this.toast.success('Proveedor creado');
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo crear');
    }
  }

  async ratificar(p: ProveedorTransporte) {
    try {
      await this.svc.ratificarProveedor(p.id);
      this.toast.success('Proveedor ratificado');
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo ratificar');
    }
  }

  async abrirPerfil(p: ProveedorTransporte) {
    if (this.abierto() === p.id) { this.abierto.set(null); return; }
    this.abierto.set(p.id);
    this.cargandoViajes.set(true);
    try {
      this.viajes.set(await this.svc.viajesDeProveedor(p.id, null));
    } catch {
      this.viajes.set([]);
    } finally {
      this.cargandoViajes.set(false);
    }
  }

  async togglePago(v: ViajeProveedor) {
    const pagar = v.estado_pago !== 'pagado';
    try {
      await this.svc.marcarViajePagado(v.viaje_id, pagar);
      this.viajes.update((list) =>
        list.map((x) => (x.viaje_id === v.viaje_id ? { ...x, estado_pago: pagar ? 'pagado' : 'pendiente_pago' } : x)),
      );
      this.toast.success(pagar ? 'Viaje marcado como pagado' : 'Viaje marcado como pendiente');
      await this.recargar();
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo actualizar el pago');
    }
  }
}
