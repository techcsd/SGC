import { test } from '@playwright/test';
import {
  loadQaUsers,
  login,
  collectPageErrors,
  MODULE_ROUTES,
  OPEN_ROUTES,
  expect,
} from './helpers';

/**
 * QA E2E — gating por rol + smoke de render + consola/red.
 * Por cada usuario QA: login → verifica que las rutas de SUS módulos cargan (no
 * redirigen a /403 ni /auth) y que las rutas de módulos AJENOS sí caen en /403;
 * recorre las rutas abiertas + las permitidas capturando errores de consola y
 * respuestas fallidas (5xx/400/404/409). No escribe datos (solo navegación).
 */
const users = loadQaUsers();

for (const user of users) {
  test.describe(`Rol: ${user.rol} (${user.email})`, () => {
    test(`login + gating + smoke`, async ({ page }) => {
      const { consoleErrors, failedRequests } = collectPageErrors(page);
      const problems: string[] = [];

      await login(page, user);

      // Rutas abiertas a todos.
      for (const ruta of OPEN_ROUTES) {
        await page.goto(ruta);
        await page.waitForLoadState('networkidle').catch(() => {});
        if (/\/(auth|403)(\/|$)/.test(new URL(page.url()).pathname)) {
          problems.push(`Ruta abierta ${ruta} redirigió a ${page.url()}`);
        }
      }

      // Gating por módulo.
      for (const { modulo, ruta } of MODULE_ROUTES) {
        await page.goto(ruta);
        await page.waitForLoadState('networkidle').catch(() => {});
        const path = new URL(page.url()).pathname;
        const forbidden = /\/403(\/|$)/.test(path);
        const debeVer = user.modulos.includes(modulo);
        if (debeVer && forbidden) {
          problems.push(`ESPERADO acceso a ${ruta} (módulo ${modulo}) pero fue 403`);
        }
        if (!debeVer && !forbidden && path.startsWith(ruta.split('/').slice(0, 2).join('/'))) {
          problems.push(`FUGA de gating: ${ruta} (módulo ${modulo}) accesible sin el módulo`);
        }
      }

      // Reporta consola/red por rol (no falla por consola, pero deja evidencia).
      const resumen = [
        problems.length ? `PROBLEMAS GATING:\n- ${problems.join('\n- ')}` : 'Gating OK',
        consoleErrors.length ? `CONSOLE ERRORS (${consoleErrors.length}):\n- ${[...new Set(consoleErrors)].slice(0, 15).join('\n- ')}` : 'Sin errores de consola',
        failedRequests.length ? `RED FALLIDA (${failedRequests.length}):\n- ${[...new Set(failedRequests)].slice(0, 15).join('\n- ')}` : 'Sin llamadas fallidas',
      ].join('\n\n');
      await test.info().attach(`resumen-${user.rol}`, { body: resumen, contentType: 'text/plain' });

      // El test FALLA solo si hay fugas de gating (lo más grave).
      expect(problems, resumen).toEqual([]);
    });
  });
}
