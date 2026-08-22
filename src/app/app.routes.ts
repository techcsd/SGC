import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { moduleGuard } from './core/guards/module.guard';
import { moduloOSubmoduloGuard } from './core/guards/modulo-o-submodulo.guard';
import { noChoferGuard } from './core/guards/no-chofer.guard';
import { tecnologiaContenedorGuard } from './core/guards/tecnologia.guard';

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
        path: 'perfil',
        loadComponent: () => import('./pages/perfil/perfil').then((m) => m.Perfil),
      },
      {
        // AT23 — Ajustes › Notificaciones: cada usuario silencia tipos de aviso.
        // Sin gate de módulo: es preferencia personal (como Mensajería/Notas).
        path: 'ajustes/notificaciones',
        loadComponent: () =>
          import('./pages/ajustes-notificaciones/ajustes-notificaciones').then(
            (m) => m.AjustesNotificaciones,
          ),
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
        // AS7 — + roles de proyecto para alcanzar /inventario/requisiciones (las
        // demás hijas siguen gateadas por su submoduloGuard).
        canActivate: [moduloOSubmoduloGuard('inventario', (u) => u.puedeVerTodasRequisiciones())],
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
        // re-valida: activos de TI con moduleGuard('tecnologia'); consola "Sistema"
        // (versiones/QA/monitoreo/errores) con tecnologiaGuard.
        path: 'tecnologia',
        canActivate: [tecnologiaContenedorGuard],
        loadChildren: () =>
          import('./pages/tecnologia/tecnologia.routes').then((m) => m.tecnologiaRoutes),
      },
      {
        // Internal messaging — available to every authenticated user.
        path: 'mensajes',
        loadComponent: () => import('./pages/mensajes/mensajes').then((m) => m.Mensajes),
      },
      {
        // AT1-AT3 — Incentivos (gestión): informe semanal, aprobar/declinar, export.
        // Lo ven quienes tienen el módulo `incentivos` (Logística, Gerencia, Admin).
        path: 'incentivos',
        canActivate: [moduleGuard('incentivos')],
        loadComponent: () => import('./pages/incentivos/incentivos').then((m) => m.Incentivos),
      },
      {
        // AT2 — "Mi rendimiento": el chofer ve SOLO su propio puntaje e histórico.
        // Sin gate de módulo (no ve el módulo Incentivos); la RLS lo limita a lo suyo.
        path: 'mi-rendimiento',
        title: 'Mi rendimiento',
        loadComponent: () => import('./pages/mi-rendimiento/mi-rendimiento').then((m) => m.MiRendimiento),
      },
      {
        // AY11 — Solicitud de movimiento: sin gate de módulo (todo usuario autenticado
        // puede crear/ver las suyas; la RLS + es_referente_movimiento gobiernan el resto).
        path: 'solicitudes-movimiento',
        title: 'Solicitud de movimiento',
        loadComponent: () =>
          import('./pages/solicitudes-movimiento/solicitudes-movimiento').then((m) => m.SolicitudesMovimiento),
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
