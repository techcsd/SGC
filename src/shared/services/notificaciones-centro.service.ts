import { Injectable, inject, signal, computed } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../app/core/services/supabase.service';
import { ToastService } from './toast.service';

/** A single row from sgc.notificaciones (per-user, RLS-scoped inbox item). */
export interface Notif {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  ruta: string | null;
  leida: boolean;
  created_at: string;
}

/** Notification Center — the header bell's inbox. This is a SEPARATE concern
 *  from NotificacionesService (which drives the nav red-dot pending counts).
 *  Here we hold the user's recent personal notifications (sgc.notificaciones),
 *  expose an unread count, and keep the list live via realtime INSERTs. */
@Injectable({ providedIn: 'root' })
export class NotificacionesCentroService {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);

  private _items = signal<Notif[]>([]);
  items = this._items.asReadonly();

  /** Unread count, derived from the loaded items. */
  noLeidas = computed(() => this._items().filter((n) => !n.leida).length);

  private channel: RealtimeChannel | null = null;

  // AT23 — tipos de aviso que el usuario silenció: se ocultan de la bandeja Y del
  // badge, SOLO para él (no cambia a quién le llega el evento). Cache en memoria.
  private _silenciados = signal<Set<string>>(new Set());
  private prefsCargadas = false;

  /** AT23 — carga (una vez) los tipos silenciados del usuario. Best-effort. */
  private async asegurarPrefs(): Promise<Set<string>> {
    if (this.prefsCargadas) return this._silenciados();
    try {
      const { data } = await this.supabase.client.rpc('mis_notif_prefs');
      const s = new Set<string>();
      for (const r of (data as { tipo: string; silenciado: boolean }[]) ?? []) {
        if (r.silenciado) s.add(r.tipo);
      }
      this._silenciados.set(s);
    } catch {
      /* best-effort: sin prefs, no se silencia nada */
    }
    this.prefsCargadas = true;
    return this._silenciados();
  }

  /** AT23 — todas las preferencias del usuario (para la pantalla de Ajustes). */
  async misNotifPrefs(): Promise<{ tipo: string; silenciado: boolean }[]> {
    const { data, error } = await this.supabase.client.rpc('mis_notif_prefs');
    if (error) throw new Error(error.message);
    return (data as { tipo: string; silenciado: boolean }[]) ?? [];
  }

  /** AT23 — silencia/reactiva un tipo; actualiza la cache y re-filtra la bandeja. */
  async setNotifPref(tipo: string, silenciado: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_notif_pref', {
      p_tipo: tipo,
      p_silenciado: silenciado,
    });
    if (error) throw new Error(error.message);
    this._silenciados.update((s) => {
      const next = new Set(s);
      if (silenciado) next.add(tipo);
      else next.delete(tipo);
      return next;
    });
    this.prefsCargadas = true;
    await this.cargar(); // re-filtra la bandeja + badge con la nueva preferencia
  }

  /** Loads the 30 most recent notifications for the current user. RLS scopes
   *  the result to usuario_id = auth.uid(), so no explicit filter is needed.
   *  AT23 — oculta los tipos que el usuario silenció. */
  async cargar(): Promise<void> {
    const silenciados = await this.asegurarPrefs();
    const { data, error } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, ruta, leida, created_at')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('NotificacionesCentroService.cargar error:', error.message);
      return;
    }
    this._items.set(((data as Notif[]) ?? []).filter((n) => !silenciados.has(n.tipo)));
  }

  /** Marks one notification as read (optimistic local update + DB write). */
  async marcarLeida(id: string): Promise<void> {
    const target = this._items().find((n) => n.id === id);
    if (!target || target.leida) return;

    this._items.update((list) => list.map((n) => (n.id === id ? { ...n, leida: true } : n)));

    const { error } = await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id);

    if (error) {
      console.error('NotificacionesCentroService.marcarLeida error:', error.message);
      // Roll back the optimistic change on failure.
      this._items.update((list) => list.map((n) => (n.id === id ? { ...n, leida: false } : n)));
    }
  }

  /** Marks every currently-unread notification as read. */
  async marcarTodasLeidas(): Promise<void> {
    const unreadIds = this._items().filter((n) => !n.leida).map((n) => n.id);
    if (unreadIds.length === 0) return;

    this._items.update((list) => list.map((n) => ({ ...n, leida: true })));

    const { error } = await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .in('id', unreadIds);

    if (error) {
      console.error('NotificacionesCentroService.marcarTodasLeidas error:', error.message);
      await this.cargar();
    }
  }

  /** Subscribes (once) to realtime INSERTs on sgc.notificaciones for this user.
   *  Realtime respects RLS, so only rows the user can SELECT arrive here. Each
   *  new row is prepended to the list and surfaced as a toast. */
  escuchar(userId: string): void {
    if (this.channel || !userId) return;

    this.channel = this.supabase.client
      .channel('rt-notif-centro')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'sgc', table: 'notificaciones', filter: `usuario_id=eq.${userId}` },
        (p) => {
          const n = p.new as Notif;
          // AT23 — un tipo silenciado no entra a la bandeja ni dispara toast.
          if (this._silenciados().has(n.tipo)) return;
          this._items.update((list) => [n, ...list].slice(0, 30));
          this.toast.info(n.titulo, n.mensaje ?? undefined, n.ruta ?? undefined);
        },
      )
      .subscribe();
  }

  stop(): void {
    if (this.channel) {
      void this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }
    this._items.set([]);
  }
}
