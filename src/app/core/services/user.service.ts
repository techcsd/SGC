import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Usuario } from '../../../shared/models/usuario.model';

const PROFILE_MAX_AGE_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class UserService {
  private supabase = inject(SupabaseService);

  private _profile = signal<Usuario | null>(null);
  profile = this._profile.asReadonly();
  private loadedAt: number | null = null;

  /** Flat list of role codes the current user has, e.g. ['admin', 'logistica'] */
  roles = computed(() => this._profile()?.roles?.map((ur) => ur.rol.codigo) ?? []);

  /** All module keys the user can access, derived from their roles */
  modulos = computed(() => {
    const all = this._profile()?.roles?.flatMap((ur) => ur.rol.modulos) ?? [];
    return [...new Set(all)];
  });

  hasRole(codigo: string): boolean {
    return this.roles().includes(codigo);
  }

  hasModulo(modulo: string): boolean {
    return this.modulos().includes(modulo);
  }

  async loadProfile(userId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('*, roles:usuarios_roles!usuario_id(rol:roles(codigo, nombre, modulos))')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('UserService.loadProfile error:', error.message);
      this._profile.set(null);
      return;
    }

    this._profile.set(data as Usuario);
    this.loadedAt = Date.now();
  }

  /** Reloads the profile if missing or older than PROFILE_MAX_AGE_MS, so a role/activo change made elsewhere takes effect without forcing a manual logout. */
  async ensureFreshProfile(userId: string): Promise<void> {
    const stale = this.loadedAt === null || Date.now() - this.loadedAt > PROFILE_MAX_AGE_MS;
    if (!this._profile() || stale) {
      await this.loadProfile(userId);
    }
  }

  clearProfile(): void {
    this._profile.set(null);
    this.loadedAt = null;
  }
}
