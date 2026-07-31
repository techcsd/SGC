import { Component, ChangeDetectionStrategy, OnInit, DestroyRef, inject } from '@angular/core';
import { NavigationError, Router, RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { UserService } from './core/services/user.service';
import { ToastService } from '../shared/services/toast.service';
import { ToastComponent } from '../shared/components/toast/toast';
import { isChunkLoadError, reloadForNewVersion } from '../shared/utils/chunk-reload.util';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    // Recuperación ante "chunk viejo tras un deploy" (index.html apunta a chunks
    // nuevos; una pestaña vieja intenta cargar los que ya no existen).
    // 1) Fallo al lazy-load de una ruta → NavigationError (caso del login).
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationError && isChunkLoadError(e.error)) {
        reloadForNewVersion();
      }
    });
    // 2) Imports dinámicos fuera del router / módulos bloqueados por MIME
    //    (Firefox los emite como error de ventana o promesa sin manejar).
    const onWindowError = (ev: ErrorEvent) => {
      if (isChunkLoadError(ev.error) || isChunkLoadError(ev.message)) reloadForNewVersion();
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      if (isChunkLoadError(ev.reason)) reloadForNewVersion();
    };
    // capture:true → los fallos de carga de <script>/módulo no burbujean; hay que
    // escucharlos en fase de captura para verlos en window.
    window.addEventListener('error', onWindowError, true);
    window.addEventListener('unhandledrejection', onRejection);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('error', onWindowError, true);
      window.removeEventListener('unhandledrejection', onRejection);
    });

    this.authService.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Distinguimos un cierre voluntario de uno por sesión vencida: solo en el
        // segundo mostramos el aviso, para que el usuario entienda por qué volvió
        // al login (antes veía errores crípticos como "Sesión inválida").
        const involuntario = !this.authService.manualSignOut;
        this.userService.clearProfile();
        this.router.navigate(['/auth']);
        if (involuntario) {
          this.toast.info(
            'Tu sesión expiró',
            'Por seguridad cerramos la sesión. Inicia sesión de nuevo para continuar.',
          );
        }
      }
    });

    // Watchdog anti-sesión-zombie: cuando el usuario vuelve a una pestaña que
    // quedó abierta mucho tiempo, el refresco en segundo plano puede haber
    // fallado y el token estar vencido aunque la UI se vea logueada. Revalidamos
    // proactivamente al recuperar el foco; si el refresh token murió,
    // ensureValidSession dispara SIGNED_OUT y el handler de arriba redirige.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.authService.ensureValidSession();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    });
  }
}
