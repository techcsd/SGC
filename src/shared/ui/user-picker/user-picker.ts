import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { SupabaseService } from '../../../app/core/services/supabase.service';

/** BR2 — usuario del directorio (para búsqueda por nombre/rol). */
export interface DirectorioUsuario {
  id: string;
  nombre: string;
  roles: string[] | null;
}

/** BR2 — emitido al elegir un usuario o escribir un nombre libre ("Otro"). */
export interface UserPickerSelection {
  usuario_id: string | null;
  nombre: string;
}

/**
 * BR2 (PROMPT-52 F3) — Selector de usuario reutilizable con búsqueda. Sustituye los
 * `<input>` de texto libre donde antes se escribía "Rakler Feliz" a mano (que no
 * enlazaba con el usuario, no notificaba ni filtraba). Busca por nombre y rol sobre
 * `directorio_usuarios_detalle`, con normalización NFD (sin acentos), chip del elegido
 * y opción "Otro (nombre libre)" para externos. Lo usan Aprobar requisición, Nueva
 * salida/conduce, Registrar entrega (BR2) y Transferir conduce (BR3).
 */
@Component({
  selector: 'app-user-picker',
  imports: [],
  templateUrl: './user-picker.html',
  styleUrl: './user-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserPicker implements OnInit {
  private supabase = inject(SupabaseService);

  /** usuario_id seleccionado (uuid) o null. */
  value = input<string | null>(null);
  /** nombre libre si está en modo "Otro". */
  nombreLibre = input<string>('');
  /** roles a los que restringir el listado (codigos). Vacío = todos. */
  filterRoles = input<string[]>([]);
  allowOtro = input<boolean>(true);
  placeholder = input<string>('Buscar por nombre o rol…');
  disabled = input<boolean>(false);

  selected = output<UserPickerSelection>();

  usuarios = signal<DirectorioUsuario[]>([]);
  query = signal('');
  open = signal(false);
  loading = signal(false);
  // modo "Otro (nombre libre)".
  otroMode = signal(false);
  otroNombre = signal('');

  private norm(s: string): string {
    return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  async ngOnInit() {
    this.otroNombre.set(this.nombreLibre());
    this.loading.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('directorio_usuarios_detalle');
      if (error) throw error;
      const roles = this.filterRoles();
      let list = ((data ?? []) as DirectorioUsuario[]).filter((u) => u.id);
      if (roles.length) {
        list = list.filter((u) => (u.roles ?? []).some((r) => roles.includes(r)));
      }
      list.sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.usuarios.set(list);
    } catch {
      /* el picker degrada a "Otro" si el directorio falla */
    } finally {
      this.loading.set(false);
    }
  }

  elegido = computed(() => {
    const id = this.value();
    return id ? this.usuarios().find((u) => u.id === id) ?? null : null;
  });

  filtered = computed(() => {
    const q = this.norm(this.query());
    if (!q) return this.usuarios().slice(0, 30);
    return this.usuarios()
      .filter((u) => this.norm(u.nombre).includes(q) || (u.roles ?? []).some((r) => this.norm(r).includes(q)))
      .slice(0, 30);
  });

  abrir() {
    if (this.disabled()) return;
    this.open.set(true);
  }

  elegir(u: DirectorioUsuario) {
    this.otroMode.set(false);
    this.open.set(false);
    this.query.set('');
    this.selected.emit({ usuario_id: u.id, nombre: u.nombre });
  }

  usarOtro() {
    this.otroMode.set(true);
    this.open.set(false);
  }

  confirmarOtro() {
    const nombre = this.otroNombre().trim();
    if (!nombre) return;
    this.selected.emit({ usuario_id: null, nombre });
  }

  limpiar() {
    this.otroMode.set(false);
    this.otroNombre.set('');
    this.query.set('');
    this.selected.emit({ usuario_id: null, nombre: '' });
  }
}
