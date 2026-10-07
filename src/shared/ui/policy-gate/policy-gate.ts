import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { PrivacidadService } from '../../services/privacidad.service';
import { SupabaseService } from '../../../app/core/services/supabase.service';

/**
 * CI3 — Gate de aceptación de políticas. Tras login, si hay versiones vigentes de
 * Privacidad/Términos sin aceptar, muestra un modal BLOQUEANTE con enlaces + "Acepto".
 * Único escape = cerrar sesión. Mismo RPC que la app (paridad). Patrón: hermano del
 * router-outlet en el shell, como language-onboarding.
 */
@Component({
  selector: 'app-policy-gate',
  imports: [],
  templateUrl: './policy-gate.html',
  styleUrl: './policy-gate.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PolicyGate implements OnInit {
  private privacidad = inject(PrivacidadService);
  private supabase = inject(SupabaseService);

  visible = signal(false);
  guardando = signal(false);
  pendientes = signal<{ documento: string; version: string }[]>([]);

  async ngOnInit() {
    try {
      const pend = await this.privacidad.politicasPendientes();
      if (pend.length) {
        this.pendientes.set(pend);
        this.visible.set(true);
      }
    } catch {
      /* sin sesión / RPC ausente → no molestar */
    }
  }

  async aceptar() {
    this.guardando.set(true);
    try {
      for (const p of this.pendientes()) {
        await this.privacidad.aceptarPolitica(p.documento, p.version);
      }
      this.visible.set(false);
    } catch {
      /* si falla, no cerramos: el usuario reintenta */
    } finally {
      this.guardando.set(false);
    }
  }

  async cerrarSesion() {
    try {
      await this.supabase.client.auth.signOut();
    } finally {
      window.location.href = '/auth';
    }
  }
}
