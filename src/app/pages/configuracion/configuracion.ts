import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Icon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icons';
import { LanguageSelector } from '../../../shared/ui/language-selector/language-selector';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { Perfil } from '../perfil/perfil';
import { AjustesNotificaciones } from '../ajustes-notificaciones/ajustes-notificaciones';
import { UserService } from '../../core/services/user.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { PreferenciasService } from '../../../shared/services/preferencias.service';
import { ThemeService, TemaPreferencia } from '../../../shared/services/theme.service';
import { ToastService } from '../../../shared/services/toast.service';
import { aplicarDensidad, aplicarTamanoLetra, Densidad, TamanoLetra } from '../../../shared/utils/apariencia.util';
import { MODULOS_DISPONIBLES } from '../../../shared/services/roles.service';
import { APP_VERSION } from '../../../environments/version';

type Seccion =
  | 'cuenta' | 'idioma' | 'apariencia' | 'notificaciones'
  | 'inicio' | 'sesion' | 'privacidad' | 'acerca';

interface OpcionInicio { route: string; label: string; modulo?: string; }

/**
 * BS3 — módulo "Configuración" (web, general para todos, sin gate de módulo).
 * Espejo del ⚙ Perfil de la app: una sola pantalla con navegación lateral por
 * secciones. Reúne lo disperso (perfil, notificaciones, tema, idioma) + nuevo
 * (sesión/dispositivos, privacidad, acerca). Todo cableado con `t()` (BS4).
 */
@Component({
  selector: 'app-configuracion',
  imports: [RouterLink, Icon, LanguageSelector, TranslatePipe, Perfil, AjustesNotificaciones],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Configuracion implements OnInit {
  private route = inject(ActivatedRoute);
  private users = inject(UserService);
  private supabase = inject(SupabaseService);
  private prefsService = inject(PreferenciasService);
  private theme = inject(ThemeService);
  private toast = inject(ToastService);

  seccion = signal<Seccion>('cuenta');
  prefs = this.prefsService.prefs;
  temaPref = this.theme.preferencia;
  esChofer = this.users.esChofer;
  esTecnologia = this.users.esTecnologia;
  appVersion = APP_VERSION;

  cerrandoSesiones = signal(false);

  /** Secciones de la navegación lateral (Privacidad solo para choferes). */
  secciones = computed<{ id: Seccion; label: string; icon: IconName }[]>(() => {
    const base: { id: Seccion; label: string; icon: IconName }[] = [
      { id: 'cuenta', label: 'Cuenta', icon: 'user' },
      { id: 'idioma', label: 'Idioma', icon: 'globe' },
      { id: 'apariencia', label: 'Apariencia', icon: 'sun' },
      { id: 'notificaciones', label: 'Notificaciones', icon: 'bell' },
      { id: 'inicio', label: 'Inicio', icon: 'home' },
      { id: 'sesion', label: 'Sesión y dispositivos', icon: 'log-out' },
    ];
    if (this.esChofer()) base.push({ id: 'privacidad', label: 'Privacidad', icon: 'map-pin' });
    base.push({ id: 'acerca', label: 'Acerca de', icon: 'info' });
    return base;
  });

  temas: { value: TemaPreferencia; label: string; icon: IconName }[] = [
    { value: 'claro', label: 'Claro', icon: 'sun' },
    { value: 'oscuro', label: 'Oscuro', icon: 'moon' },
    { value: 'sistema', label: 'Automático (sistema)', icon: 'monitor' },
  ];
  densidades: { value: Densidad; label: string }[] = [
    { value: 'compacta', label: 'Compacta' },
    { value: 'normal', label: 'Normal' },
    { value: 'comoda', label: 'Cómoda' },
  ];
  tamanos: { value: TamanoLetra; label: string }[] = [
    { value: 'pequena', label: 'Pequeña' },
    { value: 'normal', label: 'Normal' },
    { value: 'grande', label: 'Grande' },
  ];

  /** Opciones de "módulo de inicio": Panel + los módulos que el usuario tiene. */
  opcionesInicio = computed<OpcionInicio[]>(() => {
    const labelDe = (k: string) => MODULOS_DISPONIBLES.find((m) => m.key === k)?.label ?? k;
    const candidatos: OpcionInicio[] = [
      { route: '/dashboard', label: 'Panel principal' },
      { route: '/inventario/articulos', label: labelDe('inventario'), modulo: 'inventario' },
      { route: '/compras', label: labelDe('compras'), modulo: 'compras' },
      { route: '/flota/vehiculos', label: labelDe('flota'), modulo: 'flota' },
      { route: '/proyectos', label: labelDe('proyectos'), modulo: 'proyectos' },
      { route: '/rrhh', label: labelDe('rrhh'), modulo: 'rrhh' },
      { route: '/bitacora', label: labelDe('bitacora'), modulo: 'bitacora' },
      { route: '/documentos', label: labelDe('documentos'), modulo: 'documentos' },
      { route: '/direccion', label: labelDe('direccion'), modulo: 'direccion' },
      { route: '/solicitudes-movimiento', label: labelDe('ingenieria'), modulo: 'ingenieria' },
      { route: '/tareas', label: labelDe('tareas'), modulo: 'tareas' },
    ];
    return candidatos.filter((o) => !o.modulo || this.users.hasModulo(o.modulo));
  });

  async ngOnInit() {
    // Sección inicial por fragmento (#cuenta, #idioma, …) desde los deep-links.
    const frag = this.route.snapshot.fragment as Seccion | null;
    if (frag && this.secciones().some((s) => s.id === frag)) this.seccion.set(frag);
    try {
      await this.prefsService.cargar();
    } catch {
      /* best-effort: la UI usa defaults */
    }
  }

  ir(id: Seccion) {
    this.seccion.set(id);
  }

  async setTema(pref: TemaPreferencia) {
    await this.theme.aplicarPreferencia(pref);
  }

  async setDensidad(d: Densidad) {
    aplicarDensidad(d);
    try {
      await this.prefsService.set('densidad', d);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    }
  }

  async setTamano(t: TamanoLetra) {
    aplicarTamanoLetra(t);
    try {
      await this.prefsService.set('tamano_letra', t);
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    }
  }

  async setModuloInicio(route: string) {
    try {
      await this.prefsService.set('modulo_inicio', route);
      this.toast.success('Guardado', 'Al iniciar sesión abrirás aquí.');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo guardar');
    }
  }

  /** BS3 — cierra la sesión en TODOS los otros dispositivos (edge auth-signout-others). */
  async cerrarOtrasSesiones() {
    this.cerrandoSesiones.set(true);
    try {
      const { error } = await this.supabase.client.functions.invoke('auth-signout-others', {
        body: {},
      });
      if (error) throw error;
      this.toast.success('Listo', 'Cerramos tu sesión en los demás dispositivos.');
    } catch (e) {
      this.toast.errorFrom(e, 'No se pudo cerrar la sesión en otros dispositivos');
    } finally {
      this.cerrandoSesiones.set(false);
    }
  }
}
