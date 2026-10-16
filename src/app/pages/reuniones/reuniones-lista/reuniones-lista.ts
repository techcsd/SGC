import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ReunionesService, ReunionTipo, ReunionListado, ReunionFiltro, ReunionModalidad, ParticipanteExterno,
} from '../../../../shared/services/reuniones.service';
import { ProyectosService } from '../../../../shared/services/proyectos.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { UserPicker, UserPickerSelection } from '../../../../shared/ui/user-picker/user-picker';
import { TranslatePipe } from '../../../../shared/i18n/translate.pipe';
import { I18nService } from '../../../../shared/i18n/i18n.service';
import { formatFechaRelativa } from '../../../../shared/utils/fecha.util';

interface ProyectoOpcion { id: string; nombre: string }

@Component({
  selector: 'app-reuniones-lista',
  imports: [FormsModule, FormDrawer, UserPicker, TranslatePipe],
  templateUrl: './reuniones-lista.html',
  styleUrl: './reuniones-lista.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReunionesLista implements OnInit {
  private service = inject(ReunionesService);
  private proyectosService = inject(ProyectosService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  cargando = signal(true);
  reuniones = signal<ReunionListado[]>([]);
  tipos = signal<ReunionTipo[]>([]);
  proyectos = signal<ProyectoOpcion[]>([]);

  filtro = signal<ReunionFiltro>('proximas');
  filtroTipo = signal<string | null>(null);
  filtroProyecto = signal<string | null>(null);
  soloMias = signal(false);

  // Conteos de referencia para los chips (se recalculan al cambiar de filtro base).
  conteoProximas = signal(0);
  conteoActaPendiente = signal(0);

  conGrupos = computed(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
    const grupoHoy: ReunionListado[] = [];
    const grupoProximas: ReunionListado[] = [];
    for (const r of this.reuniones()) {
      const d = new Date(r.inicio);
      if (d >= hoy && d < manana) grupoHoy.push(r); else grupoProximas.push(r);
    }
    return { hoy: grupoHoy, resto: grupoProximas };
  });

  // ── Drawer "Programar reunión" ──────────────────────────────────────────
  drawerOpen = signal(false);
  nuevoTipoId = signal<string | null>(null);
  nuevoTitulo = signal('');
  nuevoFecha = signal('');
  nuevoHoraInicio = signal('09:00');
  nuevoHoraFin = signal('10:00');
  nuevoModalidad = signal<ReunionModalidad>('meet');
  nuevoLugar = signal('');
  nuevoProyectoId = signal<string | null>(null);
  nuevaAgenda = signal<string[]>([]);
  nuevoAgendaTexto = signal('');
  nuevosParticipantes = signal<{ id: string; nombre: string }[]>([]);
  nuevoExternoCorreo = signal('');
  nuevoExternoNombre = signal('');
  nuevosExternos = signal<ParticipanteExterno[]>([]);
  guardando = signal(false);

  tipoSeleccionado = computed(() => this.tipos().find((t) => t.id === this.nuevoTipoId()) ?? null);

  async ngOnInit() {
    await Promise.all([this.cargarTipos(), this.cargarProyectos(), this.cargar()]);
  }

  async cargarTipos() {
    try { this.tipos.set(await this.service.tipos()); } catch { /* el selector queda vacío */ }
  }

  async cargarProyectos() {
    try {
      const data = await this.proyectosService.misProyectos(undefined, true);
      this.proyectos.set((data ?? []).map((p: { id: string; nombre: string | null }) => ({ id: p.id, nombre: p.nombre ?? '—' })));
    } catch { /* el selector de obra queda vacío */ }
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const data = await this.service.listado(this.filtro(), this.filtroTipo(), this.filtroProyecto());
      this.reuniones.set(this.soloMias() ? data : data);
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudieron cargar las reuniones'), e instanceof Error ? e.message : undefined);
    } finally {
      this.cargando.set(false);
    }
  }

  setFiltro(f: ReunionFiltro) {
    this.filtro.set(f);
    void this.cargar();
  }
  toggleMias() {
    this.soloMias.set(!this.soloMias());
    this.setFiltro(this.soloMias() ? 'mias' : 'proximas');
  }
  onFiltroTipo(id: string) { this.filtroTipo.set(id || null); void this.cargar(); }
  onFiltroProyecto(id: string) { this.filtroProyecto.set(id || null); void this.cargar(); }

  abrir(r: ReunionListado) { void this.router.navigate(['/reuniones', r.id]); }

  // ── Crear ────────────────────────────────────────────────────────────────
  abrirDrawer() {
    this.nuevoTipoId.set(this.tipos()[0]?.id ?? null);
    this.nuevoTitulo.set('');
    const hoy = new Date();
    this.nuevoFecha.set(hoy.toISOString().slice(0, 10));
    this.nuevoHoraInicio.set('09:00');
    this.nuevoHoraFin.set('10:00');
    this.nuevoModalidad.set('meet');
    this.nuevoLugar.set('');
    this.nuevoProyectoId.set(null);
    this.nuevosParticipantes.set([]);
    this.nuevosExternos.set([]);
    this.actualizarAgendaDelTipo();
    this.drawerOpen.set(true);
  }
  cerrarDrawer() { this.drawerOpen.set(false); }

  onTipoChange(id: string) {
    this.nuevoTipoId.set(id);
    this.actualizarAgendaDelTipo();
  }
  private actualizarAgendaDelTipo() {
    this.nuevaAgenda.set([...(this.tipoSeleccionado()?.agenda_default ?? [])]);
  }
  agregarAgendaItem() {
    const t = this.nuevoAgendaTexto().trim();
    if (!t) return;
    this.nuevaAgenda.update((a) => [...a, t]);
    this.nuevoAgendaTexto.set('');
  }
  quitarAgendaItem(i: number) { this.nuevaAgenda.update((a) => a.filter((_, idx) => idx !== i)); }

  onParticipanteElegido(sel: UserPickerSelection) {
    if (!sel.usuario_id) return;
    if (this.nuevosParticipantes().some((p) => p.id === sel.usuario_id)) return;
    this.nuevosParticipantes.update((ps) => [...ps, { id: sel.usuario_id!, nombre: sel.nombre }]);
  }
  quitarParticipante(id: string) { this.nuevosParticipantes.update((ps) => ps.filter((p) => p.id !== id)); }

  agregarExterno() {
    const correo = this.nuevoExternoCorreo().trim();
    if (!correo) return;
    this.nuevosExternos.update((e) => [...e, { correo, nombre: this.nuevoExternoNombre().trim() || correo }]);
    this.nuevoExternoCorreo.set('');
    this.nuevoExternoNombre.set('');
  }
  quitarExterno(i: number) { this.nuevosExternos.update((e) => e.filter((_, idx) => idx !== i)); }

  async crear() {
    const tipoId = this.nuevoTipoId();
    const titulo = this.nuevoTitulo().trim();
    if (!tipoId || !titulo || !this.nuevoFecha()) {
      this.toast.error(this.i18n.t('Completa tipo, título y fecha.'));
      return;
    }
    const inicio = new Date(`${this.nuevoFecha()}T${this.nuevoHoraInicio()}:00`);
    const fin = new Date(`${this.nuevoFecha()}T${this.nuevoHoraFin()}:00`);
    if (fin <= inicio) {
      this.toast.error(this.i18n.t('La hora de fin debe ser después del inicio.'));
      return;
    }
    this.guardando.set(true);
    try {
      const id = await this.service.crear({
        tipoId, titulo, inicio: inicio.toISOString(), fin: fin.toISOString(),
        modalidad: this.nuevoModalidad(), lugar: this.nuevoLugar().trim() || null,
        proyectoId: this.nuevoProyectoId(),
        participantesUsuarios: this.nuevosParticipantes().map((p) => p.id),
        participantesExternos: this.nuevosExternos(),
        agenda: this.nuevaAgenda(),
      });
      this.toast.success(this.i18n.t('Reunión programada'));
      this.drawerOpen.set(false);
      await this.router.navigate(['/reuniones', id]);
    } catch (e) {
      this.toast.error(this.i18n.t('No se pudo programar la reunión'), e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  fechaCorta(iso: string): string { return formatFechaRelativa(iso); }
  hora(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' });
  }
  duracion(inicio: string, fin: string): string {
    const min = Math.round((new Date(fin).getTime() - new Date(inicio).getTime()) / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
}
