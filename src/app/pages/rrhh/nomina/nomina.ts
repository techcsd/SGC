import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RrhhNominaService } from '../../../../shared/services/rrhh-nomina.service';
import { RrhhNominaParametro, RrhhNominaPeriodo } from '../../../../shared/models/rrhh-nomina.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { formatFechaDisplay } from '../../../../shared/utils/fecha.util';

/** DN-27 P2 — Nómina y pagos. SENSIBLE. Esta pantalla SOLO administra
 *  parámetros (TSS/AFP/ISR) y períodos en borrador — NO calcula ni mueve
 *  dinero. El cálculo real espera la validación del contador (ver
 *  docs/RRHH-ADMIN.md §4). */
@Component({
  selector: 'app-rrhh-nomina',
  templateUrl: './nomina.html',
  styleUrl: './nomina.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RrhhNomina implements OnInit {
  private svc = inject(RrhhNominaService);
  private toast = inject(ToastService);

  cargando = signal(true);
  parametros = signal<RrhhNominaParametro[]>([]);
  periodos = signal<RrhhNominaPeriodo[]>([]);

  editandoClave = signal<string | null>(null);
  editValor = signal('');
  editValidado = signal(false);
  guardandoParametro = signal(false);

  mostrarFormPeriodo = signal(false);
  fNombre = signal('');
  fDesde = signal('');
  fHasta = signal('');
  guardandoPeriodo = signal(false);

  formatFecha = formatFechaDisplay;

  async ngOnInit() {
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true);
    try {
      const [parametros, periodos] = await Promise.all([this.svc.listarParametros(), this.svc.listarPeriodos()]);
      this.parametros.set(parametros);
      this.periodos.set(periodos);
    } catch (e) {
      this.toast.error('No se pudo cargar Nómina', e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  abrirEdicionParametro(p: RrhhNominaParametro) {
    this.editandoClave.set(p.clave);
    this.editValor.set(String(p.valor));
    this.editValidado.set(p.validado_por_contador);
  }

  cancelarEdicionParametro() {
    this.editandoClave.set(null);
  }

  async guardarParametro() {
    const clave = this.editandoClave();
    if (!clave) return;
    const valor = Number(this.editValor());
    if (Number.isNaN(valor)) { this.toast.warning('Valor inválido', 'Escribe un número.'); return; }
    this.guardandoParametro.set(true);
    try {
      await this.svc.actualizarParametro(clave, valor, this.editValidado());
      this.toast.success('Parámetro actualizado');
      this.editandoClave.set(null);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoParametro.set(false);
    }
  }

  abrirFormPeriodo() {
    this.fNombre.set(''); this.fDesde.set(''); this.fHasta.set('');
    this.mostrarFormPeriodo.set(true);
  }

  async guardarPeriodo() {
    const nombre = this.fNombre().trim();
    if (!nombre || !this.fDesde() || !this.fHasta()) {
      this.toast.warning('Faltan datos', 'Escribe nombre y las dos fechas del período.');
      return;
    }
    this.guardandoPeriodo.set(true);
    try {
      await this.svc.crearPeriodo(nombre, this.fDesde(), this.fHasta());
      this.toast.success('Período creado (borrador)');
      this.mostrarFormPeriodo.set(false);
      await this.cargar();
    } catch (e) {
      this.toast.error('No se pudo crear', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoPeriodo.set(false);
    }
  }
}
