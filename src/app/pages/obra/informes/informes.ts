import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { HumanizarEnumPipe } from '../../../../shared/pipes/humanizar-enum.pipe';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ObraProduccionService } from '../../../../shared/services/obra-produccion.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import { Proyecto } from '../../../../shared/models/proyecto.model';
import { InformeSemanal } from '../../../../shared/models/obra-produccion.model';
import { todayIso, formatFechaDisplay } from '../../../../shared/utils/fecha.util';
import { Skeleton } from '../../../../shared/components/skeleton/skeleton';

function isoDaysAgo(days: number): string {
  const t = todayIso(); // YYYY-MM-DD
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-obra-informes',
  imports: [HumanizarEnumPipe, ReactiveFormsModule, DecimalPipe, Skeleton],
  templateUrl: './informes.html',
  styleUrl: './informes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObraInformes implements OnInit {
  private service = inject(ObraProduccionService);
  private proyectosService = inject(ProyectosService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  formatFecha = formatFechaDisplay;

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');
  periodoInicio = signal<string>(isoDaysAgo(6));
  periodoFin = signal<string>(todayIso());

  loadingInit = signal(true);
  generando = signal(false);
  saving = signal(false);

  informe = signal<InformeSemanal | null>(null);
  fotosUrls = signal<string[]>([]);
  historial = signal<InformeSemanal[]>([]);

  puedeOperar = computed(() => this.userService.puedeOperarSubmodulo('obra.informes'));
  esBorrador = computed(() => this.informe()?.estado === 'borrador');

  manualForm = new FormGroup({
    resumen: new FormControl<string>(''),
    problemas_criticos: new FormControl<string>(''),
    decisiones: new FormControl<string>(''),
    necesidades: new FormControl<string>(''),
  });

  async ngOnInit() {
    try {
      const proyectos = await this.proyectosService.getAll();
      this.proyectos.set(proyectos);
      if (proyectos.length) {
        this.proyectoId.set(proyectos[0].id);
        await this.loadHistorial();
      }
    } catch (e: unknown) {
      this.toast.error('Error al cargar', e instanceof Error ? e.message : undefined);
    } finally {
      this.loadingInit.set(false);
    }
  }

  async onProyectoChange(id: string) {
    this.proyectoId.set(id);
    this.informe.set(null);
    this.fotosUrls.set([]);
    await this.loadHistorial();
  }

  private async loadHistorial() {
    try { this.historial.set(await this.service.getInformes(this.proyectoId())); }
    catch { this.historial.set([]); }
  }

  async generar() {
    if (!this.proyectoId() || this.generando()) return;
    this.generando.set(true);
    try {
      const id = await this.service.compilarInforme(this.proyectoId(), this.periodoInicio(), this.periodoFin());
      await this.abrirInforme(id);
      this.toast.success('Informe generado');
      await this.loadHistorial();
    } catch (e: unknown) {
      this.toast.error('No se pudo generar', e instanceof Error ? e.message : undefined);
    } finally {
      this.generando.set(false);
    }
  }

  async abrirInforme(id: string) {
    const inf = await this.service.getInforme(id);
    this.informe.set(inf);
    if (inf) {
      const cm = inf.campos_manuales ?? {};
      this.manualForm.reset({
        resumen: cm['resumen'] ?? inf.contenido ?? '',
        problemas_criticos: cm['problemas_criticos'] ?? '',
        decisiones: cm['decisiones'] ?? '',
        necesidades: cm['necesidades'] ?? '',
      });
      const fotos = inf.secciones?.fotos ?? [];
      this.fotosUrls.set(fotos.length ? await this.service.signedBitacoraUrls(fotos) : []);
    }
  }

  async guardar() {
    const inf = this.informe();
    if (!inf || this.saving()) return;
    this.saving.set(true);
    try {
      const v = this.manualForm.value;
      await this.service.guardarInformeManual(inf.id, {
        resumen: v.resumen ?? '',
        problemas_criticos: v.problemas_criticos ?? '',
        decisiones: v.decisiones ?? '',
        necesidades: v.necesidades ?? '',
      }, v.resumen ?? null);
      this.toast.success('Cambios guardados');
    } catch (e: unknown) {
      this.toast.error('Error', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  async enviar() {
    const inf = this.informe();
    if (!inf || this.saving()) return;
    if (this.esBorrador()) await this.guardar();
    this.saving.set(true);
    try {
      await this.service.enviarInforme(inf.id);
      this.toast.success('Informe enviado a Gerencia');
      await this.abrirInforme(inf.id);
      await this.loadHistorial();
    } catch (e: unknown) {
      this.toast.error('No se pudo enviar', e instanceof Error ? e.message : undefined);
    } finally {
      this.saving.set(false);
    }
  }

  imprimir() { window.print(); }

  sec = computed(() => this.informe()?.secciones ?? {});
  get fM() { return this.manualForm.controls; }
}
