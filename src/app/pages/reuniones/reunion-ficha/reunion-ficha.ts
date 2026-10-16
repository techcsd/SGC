import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ReunionesService, ReunionDetalle,
} from '../../../../shared/services/reuniones.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserService } from '../../../../app/core/services/user.service';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';

@Component({
  selector: 'app-reunion-ficha',
  imports: [FormsModule, RouterLink, UserPicker, TranslatePipe],
  templateUrl: './reunion-ficha.html',
  styleUrl: './reunion-ficha.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReunionFicha implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ReunionesService);
  private toast = inject(ToastService);
  private userService = inject(UserService);
  private i18n = inject(I18nService);

  id = signal<string>('');
  cargando = signal(true);
  detalle = signal<ReunionDetalle | null>(null);

  resumenEdit = signal('');
  guardandoActa = signal(false);
  aprobando = signal(false);

  notaPropia = signal('');
  guardandoNota = signal(false);

  nuevoAcuerdoTexto = signal('');
  nuevoAcuerdoResponsable = signal<{ id: string; nombre: string } | null>(null);
  nuevoAcuerdoFecha = signal('');
  creandoAcuerdo = signal(false);
  creandoTareas = signal(false);

  esOrganizadorOAdmin = computed(() => {
    const d = this.detalle();
    if (!d) return false;
    return d.reunion.organizador_id === this.userService.profile()?.id || this.userService.hasRole('admin');
  });

  acuerdosSinTarea = computed(() =>
    (this.detalle()?.acuerdos ?? []).filter((a) => a.responsable_id && !a.tarea_id).length,
  );

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { void this.router.navigate(['/reuniones']); return; }
    this.id.set(id);
    await this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const d = await this.service.detalle(this.id());
      this.detalle.set(d);
      this.resumenEdit.set(d.acta?.resumen ?? '');
      const miNota = d.notas.find((n) => n.es_mia);
      this.notaPropia.set(miNota?.texto ?? '');
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo abrir la reunión'), e instanceof Error ? e.message : undefined);
      void this.router.navigate(['/reuniones']);
    } finally {
      this.cargando.set(false);
    }
  }

  async guardarActa() {
    this.guardandoActa.set(true);
    try {
      await this.service.guardarActa(this.id(), this.resumenEdit());
      this.toast.success(this.i18n.t('Resumen guardado'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar el resumen'), e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoActa.set(false);
    }
  }

  async aprobarYEnviar() {
    this.aprobando.set(true);
    try {
      const n = await this.service.aprobarActa(this.id());
      this.toast.success(
        this.i18n.t('Acta aprobada'),
        this.i18n.t('{n} tarea(s) creada(s). El envío real de la minuta por correo todavía no está conectado — avísales por otro medio por ahora.', { n }),
      );
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo aprobar el acta'), e instanceof Error ? e.message : undefined);
    } finally {
      this.aprobando.set(false);
    }
  }

  async guardarNota() {
    this.guardandoNota.set(true);
    try {
      await this.service.guardarNota(this.id(), this.notaPropia());
      this.toast.success(this.i18n.t('Nota guardada'));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo guardar tu nota'), e instanceof Error ? e.message : undefined);
    } finally {
      this.guardandoNota.set(false);
    }
  }

  onResponsableElegido(sel: UserPickerSelection) {
    this.nuevoAcuerdoResponsable.set(sel.usuario_id ? { id: sel.usuario_id, nombre: sel.nombre } : null);
  }

  async crearAcuerdo() {
    const texto = this.nuevoAcuerdoTexto().trim();
    if (!texto) return;
    this.creandoAcuerdo.set(true);
    try {
      await this.service.crearAcuerdo(this.id(), texto, this.nuevoAcuerdoResponsable()?.id ?? null, this.nuevoAcuerdoFecha() || null);
      this.nuevoAcuerdoTexto.set('');
      this.nuevoAcuerdoResponsable.set(null);
      this.nuevoAcuerdoFecha.set('');
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo agregar el acuerdo'), e instanceof Error ? e.message : undefined);
    } finally {
      this.creandoAcuerdo.set(false);
    }
  }

  async crearTareas() {
    this.creandoTareas.set(true);
    try {
      const n = await this.service.crearTareasDeAcuerdos(this.id());
      this.toast.success(this.i18n.t('{n} tarea(s) creada(s)', { n }));
      await this.cargar();
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudieron crear las tareas'), e instanceof Error ? e.message : undefined);
    } finally {
      this.creandoTareas.set(false);
    }
  }

  async copiarInvitacion() {
    const d = this.detalle();
    if (!d) return;
    const inicio = new Date(d.reunion.inicio).toLocaleString('es-DO', { dateStyle: 'full', timeStyle: 'short' });
    const texto = [
      d.reunion.titulo,
      inicio,
      d.reunion.enlace ? `Enlace: ${d.reunion.enlace}` : 'Calendar no está conectado todavía — comparte el enlace por tu cuenta.',
      `Participantes: ${d.participantes.map((p) => p.nombre).join(', ')}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      this.toast.success(this.i18n.t('Invitación copiada'));
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar'));
    }
  }

  fechaLarga(iso: string): string {
    return new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  horaRango(inicio: string, fin: string): string {
    const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    return `${new Date(inicio).toLocaleTimeString('es-DO', opts)}-${new Date(fin).toLocaleTimeString('es-DO', opts)}`;
  }
}
