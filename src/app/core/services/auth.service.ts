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
    const { error } = await this.supabase.client.auth.signOut();
    return { error };
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
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
