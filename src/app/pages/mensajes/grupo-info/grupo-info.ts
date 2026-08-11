import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MensajeriaService } from '../../../../shared/services/mensajeria.service';
import { UserService } from '../../../core/services/user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { FormDrawer } from '../../../../shared/components/form-drawer/form-drawer';
import { GrupoInfo, GrupoParticipante } from '../../../../shared/models/mensaje.model';

interface UsuarioDir {
  id: string;
  nombre: string;
  email: string;
  avatar_path: string | null;
  activo: boolean;
  roles: string[];
}

@Component({
  selector: 'app-grupo-info',
  imports: [ReactiveFormsModule, FormDrawer],
  templateUrl: './grupo-info.html',
  styleUrl: './grupo-info.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrupoInfoPanel {
  private mensajeria = inject(MensajeriaService);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  conversacionId = input<string | null>(null);
  open = input<boolean>(false);

  /** Cerrar el panel. */
  closed = output<void>();
  /** Cambió algo que afecta el listado (nombre, avatar, participantes). */
  changed = output<void>();
  /** El usuario abandonó el grupo → el padre debe limpiar selección + refrescar. */
  salio = output<void>();

  miId = this.userService.profile()?.id ?? '';

  info = signal<GrupoInfo | null>(null);
  loading = signal(false);
  avatarUrl = signal<string | null>(null);
  guardando = signal(false);
  subiendoAvatar = signal(false);

  // Edición de nombre/descripción (solo admin).
  editando = signal(false);
  nombre = new FormControl('');
  descripcion = new FormControl('');

  // Agregar participante.
  agregarOpen = signal(false);
  directorio = signal<UsuarioDir[]>([]);
  buscar = signal('');
  accionEnCurso = signal(false); // usado en el template ([disabled])

  private cargadoPara: string | null = null;

  esAdmin = computed(() => this.info()?.mi_rol === 'admin');
  participantes = computed(() => this.info()?.participantes ?? []);

  directorioFiltrado = computed(() => {
    const existentes = new Set(this.participantes().map((p) => p.usuario_id));
    const q = this.buscar().toLowerCase().trim();
    return this.directorio()
      .filter((u) => u.activo && !existentes.has(u.id))
      .filter((u) => !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });

  constructor() {
    // Carga la ficha cada vez que se abre el panel para un grupo distinto.
    effect(() => {
      const abierto = this.open();
      const conv = this.conversacionId();
      if (abierto && conv && conv !== this.cargadoPara) {
        this.cargadoPara = conv;
        void this.cargar(conv);
      }
      if (!abierto) {
        this.cargadoPara = null;
      }
    });
  }

  private async cargar(conv: string) {
    this.loading.set(true);
    this.editando.set(false);
    this.agregarOpen.set(false);
    this.buscar.set('');
    try {
      const info = await this.mensajeria.grupoInfo(conv);
      this.info.set(info);
      this.nombre.setValue(info.nombre ?? '');
      this.descripcion.setValue(info.descripcion ?? '');
      this.avatarUrl.set(await this.mensajeria.getAvatarUrl(info.avatar_path));
    } catch (e: unknown) {
      this.toast.error('No se pudo cargar el grupo', e instanceof Error ? e.message : undefined);
    } finally {
      this.loading.set(false);
    }
  }

  private async recargar() {
    const conv = this.conversacionId();
    if (conv) await this.cargar(conv);
  }

  cerrar() {
    this.closed.emit();
  }

  // ── Editar nombre / descripción ──────────────────────────
  iniciarEdicion() {
    const info = this.info();
    if (!info) return;
    this.nombre.setValue(info.nombre ?? '');
    this.descripcion.setValue(info.descripcion ?? '');
    this.editando.set(true);
  }

  cancelarEdicion() {
    this.editando.set(false);
  }

  async guardarEdicion() {
    const conv = this.conversacionId();
    const nombre = this.nombre.value?.trim() ?? '';
    if (!conv || !nombre || this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.mensajeria.grupoEditar(conv, nombre, this.descripcion.value?.trim() ?? '');
      this.editando.set(false);
      await this.recargar();
      this.changed.emit();
      this.toast.success('Grupo actualizado');
    } catch (e: unknown) {
      this.toast.error('No se pudo guardar', e instanceof Error ? e.message : undefined);
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Avatar ───────────────────────────────────────────────
  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const conv = this.conversacionId();
    if (!file || !conv || !this.esAdmin() || this.subiendoAvatar()) return;
    this.subiendoAvatar.set(true);
    try {
      await this.mensajeria.subirAvatarGrupo(conv, file);
      await this.recargar();
      this.changed.emit();
      this.toast.success('Foto del grupo actualizada');
    } catch (e: unknown) {
      this.toast.error('No se pudo subir la foto', e instanceof Error ? e.message : undefined);
    } finally {
      this.subiendoAvatar.set(false);
    }
  }

  // ── Participantes ────────────────────────────────────────
  async promover(p: GrupoParticipante, admin: boolean) {
    const conv = this.conversacionId();
    if (!conv || this.accionEnCurso()) return;
    this.accionEnCurso.set(true);
    try {
      await this.mensajeria.grupoPromover(conv, p.usuario_id, admin);
      await this.recargar();
      this.changed.emit();
    } catch (e: unknown) {
      this.toast.error('No se pudo cambiar el rol', e instanceof Error ? e.message : undefined);
    } finally {
      this.accionEnCurso.set(false);
    }
  }

  async quitar(p: GrupoParticipante) {
    const conv = this.conversacionId();
    if (!conv || this.accionEnCurso()) return;
    if (!confirm(`¿Quitar a ${p.nombre} del grupo?`)) return;
    this.accionEnCurso.set(true);
    try {
      await this.mensajeria.grupoQuitar(conv, p.usuario_id);
      await this.recargar();
      this.changed.emit();
    } catch (e: unknown) {
      this.toast.error('No se pudo quitar', e instanceof Error ? e.message : undefined);
    } finally {
      this.accionEnCurso.set(false);
    }
  }

  async abrirAgregar() {
    this.buscar.set('');
    this.agregarOpen.set(true);
    if (this.directorio().length === 0) {
      try {
        this.directorio.set(await this.mensajeria.getDirectorioDetalle());
      } catch (e: unknown) {
        this.toast.error('No se pudo cargar el directorio', e instanceof Error ? e.message : undefined);
      }
    }
  }

  cerrarAgregar() {
    this.agregarOpen.set(false);
  }

  async agregar(u: UsuarioDir) {
    const conv = this.conversacionId();
    if (!conv || this.accionEnCurso()) return;
    this.accionEnCurso.set(true);
    try {
      await this.mensajeria.grupoAgregar(conv, u.id);
      await this.recargar();
      this.changed.emit();
      this.toast.success(`${u.nombre} agregado al grupo`);
    } catch (e: unknown) {
      this.toast.error('No se pudo agregar', e instanceof Error ? e.message : undefined);
    } finally {
      this.accionEnCurso.set(false);
    }
  }

  // ── Salir ────────────────────────────────────────────────
  async salir() {
    const conv = this.conversacionId();
    if (!conv || this.accionEnCurso()) return;
    if (!confirm('¿Salir de este grupo? Dejarás de recibir sus mensajes.')) return;
    this.accionEnCurso.set(true);
    try {
      await this.mensajeria.grupoSalir(conv);
      this.toast.success('Saliste del grupo');
      this.salio.emit();
      this.closed.emit();
    } catch (e: unknown) {
      this.toast.error('No se pudo salir del grupo', e instanceof Error ? e.message : undefined);
    } finally {
      this.accionEnCurso.set(false);
    }
  }

  esYo(p: GrupoParticipante): boolean {
    return p.usuario_id === this.miId;
  }

  iniciales(nombre: string): string {
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
}
