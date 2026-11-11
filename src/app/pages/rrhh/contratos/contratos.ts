import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EmpleadosService } from '../../../../shared/services/empleados.service';
import { Empleado, EmpleadoDocumento, RrhhDocumentoPorVencer } from '../../../../shared/models/empleado.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-27 (P1) — Contratos y documentos: submódulo SENSIBLE (rrhh.contratos),
 *  gateado server-side por sgc.puede_rrhh_sensible (sin bypass de admin) +
 *  cada lectura queda en sgc.rrhh_accesos_log. Vencimientos con alerta
 *  30/15/7 días sobre sgc.empleado_documentos.vigencia_hasta. */
@Component({
  selector: 'app-rrhh-contratos',
  templateUrl: './contratos.html',
  styleUrl: './contratos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhContratos implements OnInit {
  private svc = inject(EmpleadosService);
  private toast = inject(ToastService);

  cargando = signal(true);
  porVencer = signal<RrhhDocumentoPorVencer[]>([]);

  empleados = signal<Empleado[]>([]);
  empleadoSeleccionadoId = signal('');
  documentos = signal<EmpleadoDocumento[]>([]);
  cargandoDocumentos = signal(false);

  editandoId = signal<string | null>(null);
  editVigenciaDesde = signal('');
  editVigenciaHasta = signal('');
  editEsContrato = signal(false);
  guardando = signal(false);

  porVencerUrgentes = computed(() => this.porVencer().filter((d) => d.dias_restantes <= 7));
  porVencerPronto = computed(() => this.porVencer().filter((d) => d.dias_restantes > 7 && d.dias_restantes <= 15));
  porVencerEnCurso = computed(() => this.porVencer().filter((d) => d.dias_restantes > 15));

  formatFecha = formatFechaDisplay;

  async ngOnInit() {
    this.cargando.set(true);
    try {
      const [porVencer, empleados] = await Promise.all([this.svc.documentosPorVencer(30), this.svc.getAll()]);
      this.porVencer.set(porVencer);
      this.empleados.set(empleados);
    } catch (e) {
      this.toast.error('No se pudo cargar Contratos y documentos', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  async seleccionarEmpleado(id: string) {
    this.empleadoSeleccionadoId.set(id);
    this.editandoId.set(null);
    if (!id) { this.documentos.set([]); return; }
    this.cargandoDocumentos.set(true);
    try {
      this.documentos.set(await this.svc.contratosDeEmpleado(id));
    } catch (e) {
      this.toast.error('No se pudieron cargar los documentos', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargandoDocumentos.set(false);
    }
  }

  abrirEdicion(d: EmpleadoDocumento) {
    this.editandoId.set(d.id);
    this.editVigenciaDesde.set(d.vigencia_desde ?? '');
    this.editVigenciaHasta.set(d.vigencia_hasta ?? '');
    this.editEsContrato.set(!!d.es_contrato);
  }

  cancelarEdicion() {
    this.editandoId.set(null);
  }

  async guardarEdicion() {
    const id = this.editandoId();
    if (!id) return;
    this.guardando.set(true);
    try {
      await this.svc.guardarVigenciaDocumento(
        id, this.editVigenciaDesde() || null, this.editVigenciaHasta() || null, this.editEsContrato(),
      );
      this.toast.success('Guardado', 'La vigencia del documento se actualizó.');
      this.editandoId.set(null);
      await this.seleccionarEmpleado(this.empleadoSeleccionadoId());
      this.porVencer.set(await this.svc.documentosPorVencer(30));
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }
}
