import { test } from '@playwright/test';
import { loadQaUsers, login, collectPageErrors, expect } from './helpers';

/**
 * QA E2E profundo (admin) — salud de render + consola/red por CADA página, y
 * aserciones de los fixes de FASE 2. Solo navegación + asserts (no escribe datos).
 * Falla si una página no renderiza (redirige a /auth o queda vacía) o si hay 5xx.
 * Los errores de consola / 4xx se adjuntan como evidencia (no fallan por ruido benigno).
 */
const admin = loadQaUsers().find((u) => u.rol === 'admin');

const ROUTES = [
  '/dashboard', '/perfil', '/soporte', '/dudas', '/mensajes',
  '/tareas/mis-tareas', '/tareas/gestion', '/tareas/historial',
  '/inventario/articulos', '/inventario/bodegas', '/inventario/categorias',
  '/inventario/salidas', '/inventario/entradas', '/inventario/conduces',
  '/inventario/movimientos', '/inventario/conteos', '/inventario/reposicion',
  '/inventario/reportes', '/inventario/activos',
  '/compras/proveedores', '/compras/ordenes', '/compras/reportes',
  '/rrhh/empleados', '/rrhh/asistencia', '/rrhh/ausencias', '/rrhh/reportes',
  '/proyectos', '/proyectos/kpi', '/proyectos/historial', '/proyectos/clima',
  '/flota/vehiculos', '/flota/conductores', '/flota/checklists', '/flota/combustible',
  '/flota/combustible-dashboard', '/flota/mantenimientos', '/flota/rutas', '/flota/avisos',
  '/flota/panel-dia', '/flota/reporte-semanal', '/flota/responsabilidad', '/flota/reportes',
  '/bitacora/historial', '/bitacora/dashboard', '/bitacora/nueva', '/bitacora/mi-proyecto',
  '/bitacora/solicitudes-material', '/bitacora/solicitudes-compra', '/bitacora/entregas',
  '/legal/expedientes', '/legal/contratos', '/legal/aprobaciones',
  '/documentos/plantillas', '/documentos/generar', '/documentos/historial',
  '/tecnologia/guia', '/tecnologia/homologacion', '/tecnologia/matriz',
  '/tecnologia/inventario', '/tecnologia/compras',
  '/direccion',
  '/admin/usuarios', '/admin/roles', '/admin/reportes', '/admin/unidades',
  '/admin/bitacora-catalogos', '/admin/parametros', '/admin/app-versiones',
  '/admin/historial-versiones', '/admin/otros-valores', '/admin/auditoria',
];

test.describe('Deep QA (admin)', () => {
  test.skip(!admin, 'No hay usuario QA admin en qa/qa-users.local.json');

  test('salud de render + consola/red en todas las páginas', async ({ page }) => {
    test.setTimeout(360_000); // ~65 páginas
    const { consoleErrors, failedRequests } = collectPageErrors(page);
    await login(page, admin!);

    const noRender: string[] = [];
    const server5xx: string[] = [];
    for (const ruta of ROUTES) {
      const before = failedRequests.length;
      await page.goto(ruta, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const path = new URL(page.url()).pathname;
      if (/\/(auth|403)(\/|$)/.test(path)) {
        noRender.push(`${ruta} → redirigió a ${path}`);
        continue;
      }
      // Espera a que aparezca un encabezado/título de la página (render real),
      // evitando falsos positivos por leer innerText en plena transición SPA.
      const rendered = await page
        .locator('h1, .page-title, .aud__title, .guia-intro, app-skeleton')
        .first()
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (!rendered) {
        const text = (await page.locator('body').innerText().catch(() => '')) || '';
        if (text.trim().length < 40) noRender.push(`${ruta} → contenido vacío/insuficiente`);
      }
      const nuevas5xx = failedRequests.slice(before).filter((f) => f.startsWith('5'));
      if (nuevas5xx.length) server5xx.push(`${ruta}: ${nuevas5xx.join(', ')}`);
    }

    const evidencia = [
      noRender.length ? `NO RENDER:\n- ${noRender.join('\n- ')}` : `Render OK en ${ROUTES.length} páginas`,
      server5xx.length ? `5xx:\n- ${server5xx.join('\n- ')}` : 'Sin 5xx',
      consoleErrors.length ? `CONSOLE (${consoleErrors.length}, evidencia):\n- ${[...new Set(consoleErrors)].slice(0, 25).join('\n- ')}` : 'Sin errores de consola',
      failedRequests.length ? `RED 4xx/5xx (${failedRequests.length}, evidencia):\n- ${[...new Set(failedRequests)].slice(0, 25).join('\n- ')}` : 'Sin llamadas fallidas',
    ].join('\n\n');
    await test.info().attach('deep-render-evidencia', { body: evidencia, contentType: 'text/plain' });

    // Falla solo por páginas rotas o errores de servidor (no por ruido de consola).
    expect([...noRender, ...server5xx], evidencia).toEqual([]);
  });

  test('fixes FASE 2 — RD$ y panel de auditoría', async ({ page }) => {
    await login(page, admin!);

    // QA-003: Proyectos usa RD$.
    await page.goto('/proyectos');
    await page.waitForLoadState('networkidle').catch(() => {});
    const proyText = await page.locator('body').innerText();
    expect(proyText, 'Proyectos debe mostrar montos con RD$').toContain('RD$');

    // QA-018: Compras/Órdenes usa RD$ (si hay datos con montos).
    await page.goto('/compras/ordenes');
    await page.waitForLoadState('networkidle').catch(() => {});
    // No forzamos RD$ si no hay OCs; solo verificamos que no quede "DOP" crudo.
    const ocText = await page.locator('body').innerText();
    expect(ocText, 'Órdenes no debe usar el prefijo DOP').not.toContain('DOP ');

    // QA-024: Auditoría — pestaña Panel renderiza KPIs.
    await page.goto('/admin/auditoria');
    await page.waitForLoadState('networkidle').catch(() => {});
    const panelTab = page.getByRole('button', { name: /Panel/i });
    if (await panelTab.count()) {
      await panelTab.first().click();
      await page.waitForTimeout(1500);
      const audText = await page.locator('body').innerText();
      expect(audText, 'Panel de auditoría debe mostrar métricas').toMatch(/Acciones|Usuarios activos|Áreas con actividad/);
    }
  });
});
