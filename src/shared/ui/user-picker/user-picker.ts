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
  roles?: string[] | null;
  /** CK8 — códigos de rol (p. ej. `chofer_privado`), para filtrar por código y no por nombre. */
  roles_codigos?: string[] | null;
  /** CG9 — cédula/correo mostrados y buscables cuando el padre pasa `items`. */
  cedula?: string | null;
  email?: string | null;
  /** CG9 — ya enlazado a otra ficha: se muestra deshabilitado con el motivo. */
  yaVinculado?: boolean;
  motivoVinculo?: string | null;
}

/** BR2 — emitido al elegir un usuario o escribir un nombre libre ("Otro"). */
export interface UserPickerSelection {
  usuario_id: string | null;
  nombre: string;
}

const normRol = (s: string): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');

/**
 * CK8 — ¿el usuario tiene al menos uno de los roles pedidos? Compara contra los
 * CÓDIGOS (`roles_codigos`); si el RPC es viejo y no los trae, respaldo por nombre
 * normalizado (`chofer_privado` ↔ "Chofer privado"). Exportado para test unitario.
 */
export function usuarioTieneRol(u: DirectorioUsuario, roles: string[]): boolean {
  if (!roles.length) return true;
  const codigos = u.roles_codigos;
  if (codigos && codigos.length) return codigos.some((c) => roles.includes(c));
  const quiere = new Set(roles.map(normRol));
  return (u.roles ?? []).some((n) => quiere.has(normRol(n)));
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
  /** CK8 — mensaje cuando la lista queda vacía (p. ej. "No hay choferes privados…"). */
  emptyHint = input<string>('Sin resultados');
  placeholder = input<string>('Buscar por nombre o rol…');
  disabled = input<boolean>(false);
  /**
   * CG9 — lista provista por el padre (p. ej. `usuarios_vinculables`, con cédula/correo
   * y bandera `yaVinculado`). Si viene con elementos, el picker la usa en vez del RPC
   * `directorio_usuarios_detalle` y busca por nombre/correo/cédula/rol. Vacío = RPC legacy.
   */
  items = input<DirectorioUsuario[]>([]);

  selected = output<UserPickerSelection>();

  private usuariosRpc = signal<DirectorioUsuario[]>([]);
  /** Fuente efectiva: `items` del padre (CG9) o el directorio del RPC (legacy). */
  usuarios = computed(() => (this.items().length ? this.items() : this.usuariosRpc()));
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
    // CG9 — si el padre provee `items`, no se consulta el RPC (esa es la fuente).
    if (this.items().length) return;
    this.loading.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('directorio_usuarios_detalle');
      if (error) throw error;
      const roles = this.filterRoles();
      let list = ((data ?? []) as DirectorioUsuario[]).filter((u) => u.id);
      if (roles.length) {
        list = list.filter((u) => usuarioTieneRol(u, roles));
      }
      list.sort((a, b) => a.nombre.localeCompare(b.nombre));
      this.usuariosRpc.set(list);
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
    // CG9 — busca por nombre, rol, correo y cédula (NFD, sin acentos).
    return this.usuarios()
      .filter(
        (u) =>
          this.norm(u.nombre).includes(q) ||
          (u.roles ?? []).some((r) => this.norm(r).includes(q)) ||
          this.norm(u.email ?? '').includes(q) ||
          this.norm(u.cedula ?? '').includes(q),
      )
      .slice(0, 30);
  });

  abrir() {
    if (this.disabled()) return;
    this.open.set(true);
  }

  elegir(u: DirectorioUsuario) {
    if (u.yaVinculado) return; // CG9 — no se puede elegir un usuario ya enlazado a otra ficha.
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
