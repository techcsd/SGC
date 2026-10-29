import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PersonalObraService, LevantamientoHoy, LevantamientoLinea } from '../../../../shared/services/personal-obra.service';
import { ProyectosService, ObraRef } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { humanizeError } from '../../../../shared/utils/friendly-error.util';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';

/**
 * DB5 (Ronda DB) — «Levantamiento de hoy»: quién está hoy en la obra, quién es
 * NUEVO hoy (se registró hoy) y quién FALTA respecto al último levantamiento
 * cerrado. Registrar a alguien lo marca presente solo (trigger db9); aquí se
 * marca el resto y se cierra el día. Exporta el día a Excel.
 */
@Component({
  selector: 'app-personal-levantamiento',
  templateUrl: './personal-levantamiento.html',
  styleUrl: './personal-levantamiento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, TranslatePipe],
})
export class PersonalLevantamiento implements OnInit {
  private service = inject(PersonalObraService);
  private proyectos = inject(ProyectosService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  obras = signal<ObraRef[]>([]);
  obraId = signal<string>('');
  lev = signal<LevantamientoHoy | null>(null);
  loading = signal(false);
  marcando = signal<string | null>(null);
  cerrando = signal(false);
  error = signal('');

  presentes = computed(() => (this.lev()?.personal ?? []).filter((p) => p.presente === true));
  nuevosHoy = computed(() => (this.lev()?.personal ?? []).filter((p) => p.nuevo_hoy));
  faltan = computed(() => (this.lev()?.personal ?? []).filter((p) => p.en_ultimo && p.presente !== true));
  sinMarcar = computed(() => (this.lev()?.personal ?? []).filter((p) => p.presente === null));
  cerrado = computed(() => !!this.lev()?.cerrado_at);

  async ngOnInit() {
    try {
      this.obras.set(await this.proyectos.getDirectorio('personal'));
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudieron cargar las obras.');
      return;
    }
    const pre = this.route.snapshot.queryParamMap.get('obra');
    const inicial = pre || (this.obras().length === 1 ? this.obras()[0].id : '');
    if (inicial) { this.obraId.set(inicial); await this.cargar(); }
  }

  async cargar() {
    const obra = this.obraId();
    if (!obra) { this.lev.set(null); return; }
    this.loading.set(true);
    this.error.set('');
    try {
      this.lev.set(await this.service.levantamientoDeHoy(obra));
    } catch (e: unknown) {
      this.lev.set(null);
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo cargar el levantamiento.');
    } finally {
      this.loading.set(false);
    }
  }

  async marcar(p: LevantamientoLinea, presente: boolean) {
    if (this.cerrado() || this.marcando()) return;
    this.marcando.set(p.personal_id);
    try {
      await this.service.levantamientoMarcar(p.personal_id, presente);
      await this.cargar();
    } catch (e: unknown) {
      this.toast.error('No se pudo marcar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.marcando.set(null);
    }
  }

  async cerrarDia() {
    const lev = this.lev();
    if (!lev?.id || this.cerrando()) return;
    if (!confirm(`¿Cerrar el levantamiento de hoy con ${this.presentes().length} presente(s)? Después de cerrar no se puede marcar más.`)) return;
    this.cerrando.set(true);
    try {
      await this.service.levantamientoCerrar(lev.id);
      await this.cargar();
      this.toast.success('Día cerrado', 'El levantamiento de hoy quedó cerrado.');
    } catch (e: unknown) {
      this.toast.error('No se pudo cerrar', e instanceof Error ? humanizeError(e).mensaje : undefined);
    } finally {
      this.cerrando.set(false);
    }
  }

  async exportarExcel() {
    const lev = this.lev();
    if (!lev) return;
    const obra = this.obras().find((o) => o.id === this.obraId())?.nombre ?? 'obra';
    const { exportarExcelHojas } = await import('../../../../shared/utils/exportar-excel.util');
    const fila = (p: LevantamientoLinea) => ({
      Nombre: p.nombre,
      Apellido: p.apellido ?? '',
      Cargo: p.cargo ?? '',
      Documento: p.documento_numero ?? '',
      Estado: p.presente === true ? 'Presente' : p.presente === false ? 'Faltó' : 'Sin marcar',
      'Nuevo hoy': p.nuevo_hoy ? 'Sí' : '',
      'Estaba en el último levantamiento': p.en_ultimo ? 'Sí' : '',
    });
    await exportarExcelHojas(`levantamiento-${obra}-${lev.fecha}`, [
      { nombre: 'Presentes', filas: this.presentes().map(fila) },
      { nombre: 'Faltan', filas: this.faltan().map(fila) },
      { nombre: 'Todos', filas: (lev.personal ?? []).map(fila) },
    ]);
  }
}
