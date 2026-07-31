import { Injectable, inject } from '@angular/core';
import { AuthApiError, AuthError, Session, User } from '@supabase/supabase-js';
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
   * Devuelve una sesión con `access_token` VIGENTE, o `null` si el usuario ya no
   * tiene sesión válida.
   *
   * Evita el estado "zombie" que confundía a los usuarios: si el refresco en
   * segundo plano falló (la pestaña quedó abierta > 1 h, o un fallo de red
   * intermitente al llamar a `/auth/v1/token`), `getSession()` sigue devolviendo
   * la sesión vieja con el token VENCIDO. Cualquier llamada autenticada posterior
   * (edge function, RLS) fallaba luego con un críptico "Sesión inválida" —p. ej.
   * al generar el PIN de un conductor— aunque la UI se viera logueada.
   *
   * Aquí forzamos un refresco proactivo cuando el token está por vencer y, si el
   * refresh token ya no sirve, cerramos sesión limpiamente para que el guard/app
   * redirijan a login en vez de dejar al usuario atascado.
   */
  async ensureValidSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    const session = data.session;
    if (!session) return null;

    const expiresAt = session.expires_at ?? 0;
    const now = Math.floor(Date.now() / 1000);
    // Aún vigente con holgura (> 90 s): no toques nada.
    if (expiresAt - now > 90) return session;

    // Token vencido o por vencer → fuerza un refresco explícito.
    const { data: refreshed, error } = await this.supabase.client.auth.refreshSession();
    if (error) {
      // Refresh token inválido/revocado (AuthApiError): supabase-js ya limpió la
      // sesión y emitió SIGNED_OUT. Devolvemos null para que se redirija a login.
      if (error instanceof AuthApiError) return null;
      // Fallo de red transitorio (retryable): NO expulsamos por un blip; se
      // reintentará solo. Devolvemos lo que haya.
      return session;
    }
    return refreshed.session ?? null;
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
