import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { authGuard } from './core/guards/auth.guard';
import { moduleGuard } from './core/guards/module.guard';
import { moduloOSubmoduloGuard } from './core/guards/modulo-o-submodulo.guard';
import { noChoferGuard } from './core/guards/no-chofer.guard';
import { rolesGuard } from './core/guards/roles.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./pages/auth/auth').then((m) => m.Auth),
  },
  {
    path: 'auth/set-password',
    loadComponent: () => import('./pages/auth/set-password/set-password').then((m) => m.SetPassword),
  },
  {
    // CE5 — verificación pública del carnet por QR (sin login, datos mínimos).
    path: 'verificar/:carnet',
    loadComponent: () => import('./pages/verificar/verificar').then((m) => m.Verificar),
  },
  {
    // CI4 — eliminación de cuenta pública (con formulario). Debe ir ANTES de
    // 'politicas/:doc' para ganar el match del path estático.
    path: 'politicas/eliminar-cuenta',
    loadComponent: () =>
      import('./pages/politicas/eliminar-cuenta/eliminar-cuenta').then((m) => m.EliminarCuenta),
    title: 'Eliminar cuenta · Constructora SD',
  },
  {
    // CI2 — páginas legales públicas (sin login): privacidad, términos, soporte.
    // Renderizan assets/politicas/<doc>.md. Patrón: fuera del Shell (como verificar).
    path: 'politicas/:doc',
    loadComponent: () => import('./pages/politicas/politicas').then((m) => m.Politicas),
  },
  {
    // CR1 (FASE 3) — pantalla de autorización del servidor OAuth de Supabase
    // (Claude Desktop y, a futuro, cualquier conector). Fuera del Shell: la
    // propia página exige sesión (vía authService) y vuelve aquí tras el login
    // conservando authorization_id — un canActivate normal perdería el query param.
    path: 'oauth/consent',
    loadComponent: () => import('./pages/oauth-consent/oauth-consent').then((m) => m.OauthConsent),
    title: 'Autorizar a Claude · SGC',
  },
  {
    path: '',
    loadComponent: () => import('../shared/components/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        // CR1 (FASE 4) — borrador preparado por Claude Desktop (mock `Borrador-claude`).
        // Dentro del Shell: cualquier usuario autenticado puede tener borradores propios
        // (sin gate de módulo — como Mensajería/Notas), igual que "Mis tareas".
        path: 'borrador/:id',
        loadComponent: () => import('./pages/borrador-claude/borrador-claude').then((m) => m.BorradorClaude),
      },
      {
        path: 'direccion',
        canActivate: [moduleGuard('direccion')],
        loadComponent: () => import('./pages/direccion/direccion').then((m) => m.Direccion),
      },
      {
        path: 'soporte',
        loadComponent: () => import('./pages/soporte/soporte').then((m) => m.Soporte),
      },
      {
        path: 'app-movil',
        loadComponent: () => import('./pages/app-movil/app-movil').then((m) => m.AppMovil),
        title: 'CSD App (móvil)',
      },
      {
        path: 'dudas',
        loadComponent: () => import('./pages/dudas/dudas').then((m) => m.Dudas),
      },
      {
        // CM7 — modo práctica (sin gate de módulo: para todos, como Dudas).
        path: 'practica',
        loadComponent: () => import('./pages/practica/practica').then((m) => m.Practica),
        title: 'Modo práctica',
      },
      {
        // BS3 — módulo "Configuración" (general, sin gate de módulo: como Notas/Mensajes).
        path: 'configuracion',
        loadComponent: () =>
          import('./pages/configuracion/configuracion').then((m) => m.Configuracion),
      },
      {
        // BS3 — /perfil se unifica en Configuración › Cuenta (deep-links vivos).
        path: 'perfil',
        redirectTo: () => inject(Router).parseUrl('/configuracion#cuenta'),
      },
      {
        // CR1 (FASE 6) — Perfil › Claude (mock Perfil-claude). Ruta propia (no
        // una pestaña de Configuración: es una pantalla rica, como Mensajes/Notas).
        path: 'configuracion/claude',
        loadComponent: () =>
          import('./pages/configuracion/claude/configuracion-claude').then((m) => m.ConfiguracionClaude),
        title: 'Claude — Perfil',
      },
      {
        // AT23/BS3 — Ajustes › Notificaciones vive ahora en Configuración › Notificaciones.
        // Sin gate de módulo: preferencia personal. Los deep-links de correos siguen vivos.
        path: 'ajustes/notificaciones',
        redirectTo: () => inject(Router).parseUrl('/configuracion#notificaciones'),
      },
      {
        // AU8 — "Conduces por firmar" (bandeja del despachante) es un inbox PERSONAL:
        // vivía en /inventario/por-firmar y heredaba el guard del módulo Inventario,
        // así que un chofer (que no debe firmar) veía el item y caía en 403, y un
        // ingeniero de obra SÍ autorizado a firmar pero sin el módulo inventario
        // también habría caído en 403. Se hoista a ruta propia gateada SOLO por
        // noChoferGuard (la RLS del RPC ya limita a los conduces del firmante).
        // El redirect mantiene vivos los deep-links viejos (pushes/correos, lección AK8).
        path: 'inventario/por-firmar',
        redirectTo: 'por-firmar',
        pathMatch: 'full',
      },
      {
        // AU9 — deep-links viejos de notificaciones/correos (RPC asignar_firma_pendiente,
        // recordar_conduces_por_firmar, crear_conduce_simple, chofer_registrar_devolucion)
        // apuntan a /transporte/por-firmar (módulo Transporte retirado en AK8). Redirect
        // para que esos pushes/correos ya enviados no caigan en 404.
        path: 'transporte/por-firmar',
        redirectTo: 'por-firmar',
        pathMatch: 'full',
      },
      {
        path: 'por-firmar',
        title: 'Conduces por firmar',
        canActivate: [noChoferGuard],
        loadComponent: () =>
          import('./pages/inventario/por-firmar/por-firmar').then((m) => m.ConducesPorFirmar),
      },
      {
        path: 'inventario',
        // AN2 — módulo completo O cualquier submódulo granular (cada hija afina).
        // AS7 — + roles de proyecto para alcanzar /inventario/requisiciones.
        // BJ3 — + chofer, para alcanzar /inventario/salidas y crear su conduce
        // (espejo sync de puede_crear_conduce; el guard de la hija lo ratifica por
        // RPC). Las demás hijas siguen protegidas por su submoduloGuard.
        canActivate: [
          moduloOSubmoduloGuard(
            'inventario',
            // CG6 — el chofer de flota entra a salidas (crea conduces); el privado NO.
            (u) => u.puedeVerTodasRequisiciones() || u.esChoferFlota(),
          ),
        ],
        loadChildren: () =>
          import('./pages/inventario/inventario.routes').then((m) => m.inventarioRoutes),
      },
      {
        path: 'admin',
        canActivate: [moduleGuard('admin')],
        loadChildren: () => import('./pages/admin/admin.routes').then((m) => m.adminRoutes),
      },
      {
        path: 'flota',
        // AN2 — módulo completo O cualquier submódulo granular (cada hija afina).
        canActivate: [moduloOSubmoduloGuard('flota')],
        loadChildren: () => import('./pages/flota/flota.routes').then((m) => m.flotaRoutes),
      },
      {
        path: 'bitacora',
        canActivate: [moduleGuard('bitacora')],
        loadChildren: () => import('./pages/bitacora/bitacora.routes').then((m) => m.bitacoraRoutes),
      },
      {
        path: 'documentos',
        canActivate: [moduleGuard('documentos')],
        loadChildren: () => import('./pages/documentos/documentos.routes').then((m) => m.documentosRoutes),
      },
      {
        // AF32 — el gate se aplica por submódulo (proveedores lo abre también el
        // jefe de flota); órdenes y reportes siguen requiriendo módulo compras.
        path: 'compras',
        loadChildren: () =>
          import('./pages/compras/compras.routes').then((m) => m.comprasRoutes),
      },
      {
        path: 'rrhh',
        canActivate: [moduleGuard('rrhh')],
        loadChildren: () => import('./pages/rrhh/rrhh.routes').then((m) => m.rrhhRoutes),
      },
      {
        path: 'proyectos',
        // AR1 — módulo completo O submódulo granular (p. ej. 'proyectos.personal'
        // para capataces). Cada ruta hija afina con submoduloGuard.
        canActivate: [moduloOSubmoduloGuard('proyectos')],
        loadChildren: () =>
          import('./pages/proyectos/proyectos.routes').then((m) => m.proyectosRoutes),
      },
      {
        path: 'legal',
        canActivate: [moduleGuard('legal')],
        loadChildren: () => import('./pages/legal/legal.routes').then((m) => m.legalRoutes),
      },
      {
        // CP8 — módulo Reuniones.
        path: 'reuniones',
        canActivate: [moduleGuard('reuniones')],
        loadChildren: () => import('./pages/reuniones/reuniones.routes').then((m) => m.reunionesRoutes),
      },
      {
        // AG16 — Producción de Obra. Sin moduleGuard en el parent: cada submódulo
        // se gatea con submoduloGuard (el capataz entra por permiso granular).
        path: 'obra',
        loadChildren: () => import('./pages/obra/obra.routes').then((m) => m.obraRoutes),
      },
      {
        // No module guard here: any authenticated user has "Mis tareas".
        // The manager-only "gestion" child guards itself with moduleGuard('tareas').
        path: 'tareas',
        loadChildren: () => import('./pages/tareas/tareas.routes').then((m) => m.tareasRoutes),
      },
      {
        // AL1 — El contenedor exige módulo `tecnologia` O es_tecnologia (corrige la
        // fuga por la que todo usuario no-chofer veía "Tecnología"). Cada hijo
        // re-valida: activos de TI con submoduloGuard('tecnologia.*'); consola "Sistema"
        // (versiones/QA/monitoreo/errores) con tecnologiaGuard.
        // CZ4 — + cualquier permiso granular 'tecnologia.*' (Subadministrador), que
        // antes se quedaba sin poder entrar al contenedor aunque sus hijas (Cotizaciones,
        // Inventario, Compras) ya lo dejaran pasar — hallazgo F3, el contenedor era
        // MÁS estricto que sus propias hijas.
        path: 'tecnologia',
        canActivate: [moduloOSubmoduloGuard('tecnologia', (u) => u.esTecnologia())],
        loadChildren: () =>
          import('./pages/tecnologia/tecnologia.routes').then((m) => m.tecnologiaRoutes),
      },
      {
        // Internal messaging — available to every authenticated user.
        path: 'mensajes',
        loadComponent: () => import('./pages/mensajes/mensajes').then((m) => m.Mensajes),
      },
      {
        // AW4 — Tato, el asistente de IA. Sin gate de módulo: hereda los permisos
        // del usuario (la edge function ejecuta las herramientas con su JWT).
        path: 'asistente',
        loadComponent: () => import('./pages/asistente/asistente').then((m) => m.Asistente),
      },
      {
        // AT1-AT3 — Incentivos (gestión): informe semanal, aprobar/declinar, export.
        // Lo ven quienes tienen el módulo `incentivos` (Logística, Gerencia, Admin).
        path: 'incentivos',
        canActivate: [moduleGuard('incentivos')],
        loadComponent: () => import('./pages/incentivos/incentivos').then((m) => m.Incentivos),
      },
      {
        // AT2/AV2 — "Mi rendimiento": vista personal del incentivo. SOLO Chofer y Jefe
        // de flota (los roles del incentivo). El guard impide el acceso por URL directa
        // a otros roles (el admin usa /incentivos). La RLS lo limita a su propio puntaje.
        path: 'mi-rendimiento',
        title: 'Mi rendimiento',
        canActivate: [rolesGuard('chofer_transportista', 'jefe_flota')],
        loadComponent: () => import('./pages/mi-rendimiento/mi-rendimiento').then((m) => m.MiRendimiento),
      },
      {
        // CK12 — "Apoyo de transporte" (evoluciona AY11): sin gate de módulo (todo usuario
        // autenticado; RLS + es_referente_movimiento gobiernan el resto).
        path: 'transporte/apoyo',
        title: 'Apoyo de transporte',
        loadComponent: () =>
          import('./pages/apoyo-transporte/apoyo-transporte').then((m) => m.ApoyoTransporte),
      },
      {
        // La ruta vieja redirige al módulo nuevo (apps/enlaces guardados siguen).
        path: 'solicitudes-movimiento',
        redirectTo: 'transporte/apoyo',
        pathMatch: 'full',
      },
      {
        // CK15 — bandeja de trabajos de transporte (Misael/flota elevada). El RPC gatea por rol.
        path: 'transporte/trabajos',
        title: 'Trabajos de transporte',
        loadComponent: () =>
          import('./pages/trabajos-transporte/trabajos-transporte').then((m) => m.TrabajosTransporte),
      },
      {
        // CK16 — monitoreo de choferes (flota elevada). El RPC gatea por rol.
        path: 'transporte/mis-choferes',
        title: 'Mis choferes',
        loadComponent: () =>
          import('./pages/mis-choferes/mis-choferes').then((m) => m.MisChoferes),
      },
      {
        // Personal + shared notes — no module gate, every authenticated user.
        path: 'notas',
        loadComponent: () => import('./pages/notas/notas').then((m) => m.Notas),
      },
      {
        // AD9 — Notas v2: editor en página completa (nueva/:id).
        path: 'notas/nueva',
        loadComponent: () => import('./pages/notas/editor/nota-editor').then((m) => m.NotaEditor),
      },
      {
        path: 'notas/:id',
        loadComponent: () => import('./pages/notas/editor/nota-editor').then((m) => m.NotaEditor),
      },
    ],
  },
  {
    path: '403',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.Forbidden),
  },
  { path: '**', redirectTo: '' },
];
