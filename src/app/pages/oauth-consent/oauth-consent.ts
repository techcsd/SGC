import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { PrivacidadService } from '../../../shared/services/privacidad.service';

/**
 * CR1 (FASE 3) — `/oauth/consent`: pantalla de autorización del servidor OAuth
 * de Supabase (mock `Main`). La activa `supabase/config.toml` vía
 * `oauth_server_authorization_path`. Sin sesión → manda a /auth y vuelve con el
 * mismo `authorization_id`. Si el cliente no es de Claude (redirect_uri fuera
 * de la lista blanca), bloquea "Permitir" salvo que un admin encienda
 * `claude_conector_clientes_extra` (ver docs/CLAUDE-CONECTOR.md).
 */

// docs/CLAUDE-CONECTOR.md §7 — redirect_uri reales de Claude (Desktop/web/móvil/Cowork).
const CLIENTES_CLAUDE = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

interface AuthorizationDetails {
  authorization_id?: string;
  client?: { name?: string };
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
}

@Component({
  selector: 'app-oauth-consent',
  imports: [ButtonDirective, TranslatePipe, RouterLink],
  templateUrl: './oauth-consent.html',
  styleUrl: './oauth-consent.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OauthConsent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private supabase = inject(SupabaseService);
  private privacidad = inject(PrivacidadService);

  cargando = signal(true);
  error = signal<string | null>(null);
  detalles = signal<AuthorizationDetails | null>(null);
  entendido = signal(true); // mock: casilla marcada por defecto
  enviando = signal(false);
  clienteConfiable = signal(true);

  nombreUsuario = () => this.userService.profile()?.nombre ?? '';

  private authorizationId = '';

  async ngOnInit() {
    this.authorizationId = this.route.snapshot.queryParamMap.get('authorization_id') ?? '';
    if (!this.authorizationId) {
      this.cargando.set(false);
      this.error.set('Falta authorization_id en el enlace. Vuelve a intentar conectar desde Claude.');
      return;
    }

    const session = await this.authService.ensureValidSession();
    if (!session) {
      const vuelta = `/oauth/consent?authorization_id=${encodeURIComponent(this.authorizationId)}`;
      this.router.navigate(['/auth'], { queryParams: { redirect: vuelta } });
      return;
    }
    // Fuera del Shell: nadie más carga el perfil (authGuard no corre aquí).
    await this.userService.ensureFreshProfile(session.user.id);

    await this.cargarDetalles();
  }

  private async cargarDetalles() {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const { data, error } = await this.supabase.client.auth.oauth.getAuthorizationDetails(
        this.authorizationId,
      );
      if (error) throw error;
      const d = data as AuthorizationDetails;
      // Ya había consentido antes: Supabase devuelve directo { redirect_url }, sin authorization_id.
      if (d && !d.authorization_id && d.redirect_url) {
        window.location.href = d.redirect_url;
        return;
      }
      this.detalles.set(d);
      this.clienteConfiable.set(this.esClienteConfiable(d?.redirect_uri));
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? `No se pudo cargar la solicitud de autorización: ${e.message}`
          : 'No se pudo cargar la solicitud de autorización.',
      );
    } finally {
      this.cargando.set(false);
    }
  }

  private esClienteConfiable(redirectUri?: string): boolean {
    if (!redirectUri) return false;
    return CLIENTES_CLAUDE.includes(redirectUri);
  }

  permisos(): string[] {
    const scope = this.detalles()?.scope ?? '';
    return scope.split(' ').map((s) => s.trim()).filter(Boolean);
  }

  async permitir() {
    if (this.enviando() || !this.clienteConfiable() || !this.entendido()) return;
    this.enviando.set(true);
    try {
      // CR1 §B1 — la misma casilla registra el consentimiento de IA con el RPC
      // de Perfil › Privacidad (mi_consentimiento/set_consentimiento), el
      // servidor mcp lo vuelve a exigir en cada tools/call.
      await this.privacidad.setConsentimiento('ia', true).catch(() => {
        /* best-effort: el servidor lo vuelve a exigir en cada llamada igual */
      });
      const { data, error } = await this.supabase.client.auth.oauth.approveAuthorization(
        this.authorizationId,
      );
      if (error) throw error;
      window.location.href = (data as { redirect_url: string }).redirect_url;
    } catch (e) {
      this.enviando.set(false);
      this.error.set(e instanceof Error ? e.message : 'No se pudo autorizar a Claude.');
    }
  }

  async cancelar() {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.oauth.denyAuthorization(
        this.authorizationId,
      );
      if (error) throw error;
      window.location.href = (data as { redirect_url: string }).redirect_url;
    } catch {
      this.enviando.set(false);
      this.router.navigate(['/dashboard']);
    }
  }

  async noSoyYo() {
    const vuelta = `/oauth/consent?authorization_id=${encodeURIComponent(this.authorizationId)}`;
    await this.authService.signOut();
    this.userService.clearProfile();
    this.router.navigate(['/auth'], { queryParams: { redirect: vuelta } });
  }
}
