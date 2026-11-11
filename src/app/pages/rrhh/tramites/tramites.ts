import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RrhhAdministracionService } from '../../../../shared/services/rrhh-administracion.service';
import { RrhhTramite, TramiteTipo } from '../../../../shared/models/rrhh-administracion.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialog } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-29 (P2 de Administración) — Trámites y cumplimiento: permisos, licencias,
 *  seguros e impuestos de la empresa, con vencimientos. No sensible (igual que
 *  Proveedores/Activos: logística de oficina, no dato personal del empleado). */
@Component({
  selector: 'app-rrhh-tramites',
  imports: [ConfirmDialog],
  templateUrl: './tramites.html',
  styleUrl: './tramites.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhTramites implements OnInit {
  private svc = inject(RrhhAdministracionService);
  private toast = inject(ToastService);

  cargando = signal(true);
  tramites = signal<RrhhTramite[]>([]);
  guardando = signal(false);
  mostrarForm = signal(false);
  aEliminar = signal<RrhhTramite | null>(null);

  fNombre = signal('');
  fTipo = signal<TramiteTipo>('permiso');
  fEntidad = signal('');
  fNumero = signal('');
  fEmision = signal('');
  fVencimiento = signal('');
  fNotas = signal('');

  formatFecha = formatFechaDisplay;

  vencidos = computed(() => this.tramites().filter((t) => t.estado === 'vencido' || (t.fecha_vencimiento && t.fecha_vencimiento < this.hoy())));
  porVencer30d = computed(() => {
    const limite = new Date(); limite.setDate(limite.getDate() + 30);
    const limiteStr = limite.toISOString().slice(0, 10);
    return this.tramites().filter((t) =>
      t.estado !== 'vencido' && t.fecha_vencimiento && t.fecha_vencimiento >= this.hoy() && t.fecha_vencimiento <= limiteStr);
  });
  resto = computed(() => {
    const idsVencidos = new Set(this.vencidos().map((t) => t.id));
    const idsPorVencer = new Set(this.porVencer30d().map((t) => t.id));
    return this.tramites().filter((t) => !idsVencidos.has(t.id) && !idsPorVencer.has(t.id));
  });

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      this.tramites.set(await this.svc.listarTramites());
    } catch (e) {
      this.toast.error('No se pudieron cargar los trámites', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirForm() {
    this.fNombre.set(''); this.fTipo.set('permiso'); this.fEntidad.set('');
    this.fNumero.set(''); this.fEmision.set(''); this.fVencimiento.set(''); this.fNotas.set('');
    this.mostrarForm.set(true);
  }

  async guardar() {
    const nombre = this.fNombre().trim();
    if (!nombre) { this.toast.warning('Falta el nombre', 'Escribe a qué trámite corresponde.'); return; }
    this.guardando.set(true);
    try {
      await this.svc.crearTramite({
        nombre, tipo: this.fTipo(), entidad_responsable: this.fEntidad().trim() || null,
        numero_referencia: this.fNumero().trim() || null, fecha_emision: this.fEmision() || null,
        fecha_vencimiento: this.fVencimiento() || null, notas: this.fNotas().trim() || null,
      });
      this.toast.success('Trámite guardado');
      this.mostrarForm.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  async marcarRenovado(t: RrhhTramite) {
    try {
      await this.svc.actualizarEstadoTramite(t.id, 'vigente');
      await this.cargar();
      this.toast.success('Marcado como vigente');
    } catch (e) {
      this.toast.error('No se pudo actualizar', e instanceof Error ? e.message : undefined);
    }
  }

  pedirEliminar(t: RrhhTramite) {
    this.aEliminar.set(t);
  }

  async confirmarEliminar() {
    const t = this.aEliminar();
    if (!t) return;
    try {
      await this.svc.eliminarTramite(t.id);
      this.toast.success('Trámite eliminado');
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo eliminar', e instanceof Error ? e.message : undefined);
    } finally {
      this.aEliminar.set(null);
    }
  }
}
