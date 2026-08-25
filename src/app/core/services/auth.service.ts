import { Injectable, inject } from '@angular/core';
import { AuthError, Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { environment } from '../../../environments/environment';
import { edgeErrorDetail } from '../../../shared/utils/edge.util';

export interface AuthResult {
  user: User | null;
  error: AuthError | null;
}

/** P5 — resultado del login de conductor (cédula + PIN). */
export interface ConductorLoginResult {
  user: User | null;
  /** Mensaje de error legible, o null si fue exitoso. */
  error: string | null;
  /** Segundos restantes de bloqueo si aplica (429). */
  retryInSeconds?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SupabaseService);

  /**
   * True mientras se procesa un cierre de sesión iniciado por el usuario. Deja
   * distinguir un `SIGNED_OUT` voluntario de uno provocado por una sesión
   * vencida (para no mostrar el aviso "tu sesión expiró" al cerrar sesión a
   * propósito). Lo lee el watchdog en `app.ts`.
   */
  manualSignOut = false;

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email,
      password,
    });
    return { user: data.user, error };
  }

  /**
   * P5 — Login de conductor por cédula + PIN. Llama a la edge `conductor-login`
   * (mapea cédula→email sintético + bloqueo por intentos) y, si es válida,
   * establece la sesión en el cliente. Devuelve mensaje claro y, si está
   * bloqueado, los segundos restantes.
   */
  async conductorLogin(cedula: string, pin: string): Promise<ConductorLoginResult> {
    // R13 — timeout defensivo: si la edge se cuelga (cold start / red a medias),
    // el spinner quedaba infinito. Cortamos a 12s con mensaje claro y reintento.
    const TIMEOUT_MS = 12000;
    const timeout = Symbol('timeout');
    const invocation = this.supabase.client.functions.invoke('conductor-login', {
      body: { cedula, pin },
    });
    const raced = await Promise.race([
      invocation,
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), TIMEOUT_MS)),
    ]);
    if (raced === timeout) {
      return { user: null, error: 'El servidor no respondió. Revisa tu conexión e intenta de nuevo.' };
    }
    const { data, error } = raced;

    if (error) {
      const detail = await edgeErrorDetail(error);
      const retry = detail.body?.['retryInSeconds'];
      return {
        user: null,
        error: detail.message,
        retryInSeconds: typeof retry === 'number' ? retry : undefined,
      };
    }
    if (data?.error) {
      return { user: null, error: data.error as string, retryInSeconds: data.retryInSeconds };
    }
    if (!data?.access_token || !data?.refresh_token) {
      return { user: null, error: 'Respuesta de acceso inválida.' };
    }

    const { data: sess, error: setErr } = await this.supabase.client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (setErr || !sess.user) {
      return { user: null, error: setErr?.message ?? 'No se pudo iniciar la sesión.' };
    }
    return { user: sess.user, error: null };
  }

  // ── AY7 — "Entrar como" un usuario de prueba, conservando la sesión admin ──
  private readonly IMP_KEY = 'sgc-impersonacion';

  /** Guarda la sesión actual (admin) y entra con las credenciales del usuario test. */
  async impersonarUsuarioTest(email: string, password: string): Promise<{ error: string | null }> {
    const actual = await this.getSession();
    if (actual?.refresh_token) {
      try {
        localStorage.setItem(this.IMP_KEY, JSON.stringify({
          access_token: actual.access_token, refresh_token: actual.refresh_token,
        }));
      } catch { /* ignore */ }
    }
    const { error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    if (error) {
      try { localStorage.removeItem(this.IMP_KEY); } catch { /* ignore */ }
      return { error: error.message };
    }
    return { error: null };
  }

  /** ¿Hay una sesión admin guardada a la que volver? */
  hayImpersonacion(): boolean {
    try { return !!localStorage.getItem(this.IMP_KEY); } catch { return false; }
  }

  /** Restaura la sesión admin guardada (fin de "entrar como"). */
  async volverDeImpersonacion(): Promise<{ error: string | null }> {
    let saved: { access_token: string; refresh_token: string } | null = null;
    try { saved = JSON.parse(localStorage.getItem(this.IMP_KEY) || 'null'); } catch { saved = null; }
    if (!saved?.refresh_token) return { error: 'No hay sesión a la que volver.' };
    const { error } = await this.supabase.client.auth.setSession(saved);
    try { localStorage.removeItem(this.IMP_KEY); } catch { /* ignore */ }
    return { error: error?.message ?? null };
  }

  async signOut(): Promise<{ error: AuthError | null }> {
    this.manualSignOut = true;
    try {
      const { error } = await this.supabase.client.auth.signOut();
      return { error };
    } finally {
      // El evento SIGNED_OUT se emite dentro de signOut(); lo reseteamos después.
      this.manualSignOut = false;
    }
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
  }

  /**
   * Devuelve una sesión con `access_token` VIGENTE, o `null` si la sesión está
   * genuinamente muerta (para que el guard/app redirijan a login).
   *
   * Delega en `getSession()` a propósito: internamente refresca el token si está
   * vencido (single-flight, SIN carrera con el auto-refresh), CONSERVA la sesión
   * ante fallos de refresco transitorios (blip de red) y solo devuelve `null`
   * cuando el token realmente expiró y el refresh token ya no sirve. Eso evita el
   * estado "zombie" (token muerto pero UI logueada) que hacía fallar acciones
   * como generar el PIN con "Sesión inválida".
   *
   * NO usar `refreshSession()` aquí: es un "explicit refresh entry point" que
   * ante CUALQUIER error de refresco cierra la sesión de golpe → provocaba que la
   * web saliera sola al refrescar (carrera con el auto-refresh de arranque).
   */
  async ensureValidSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session ?? null;
  }

  async getUser(): Promise<User | null> {
    const { data } = await this.supabase.client.auth.getUser();
    return data.user;
  }

  async resetPassword(email: string): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${environment.appUrl || window.location.origin}/auth/set-password`,
    });
    return { error };
  }

  async updateUser(password: string): Promise<{ error: AuthError | null }> {
    const { error } = await this.supabase.client.auth.updateUser({ password });
    return { error };
  }

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return this.supabase.client.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
}
