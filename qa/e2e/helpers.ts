import { Page, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface QaUser {
  email: string;
  password: string;
  rol: string; // etiqueta legible
  modulos: string[]; // módulos que DEBE ver (para gating)
}

/** Lee las credenciales QA de un archivo gitignoreado. */
export function loadQaUsers(): QaUser[] {
  const path = join(process.cwd(), 'qa', 'qa-users.local.json');
  if (!existsSync(path)) {
    throw new Error(
      'Falta qa/qa-users.local.json (gitignoreado) con los usuarios QA. ' +
        'Formato: [{ "email": "...", "password": "...", "rol": "admin", "modulos": ["inventario", ...] }]',
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as QaUser[];
}

/** Todas las rutas de módulo (para probar gating: permitido vs 403). */
export const MODULE_ROUTES: { modulo: string; ruta: string }[] = [
  { modulo: 'inventario', ruta: '/inventario/articulos' },
  { modulo: 'compras', ruta: '/compras/ordenes' },
  { modulo: 'rrhh', ruta: '/rrhh/empleados' },
  { modulo: 'proyectos', ruta: '/proyectos' },
  { modulo: 'flota', ruta: '/flota/vehiculos' },
  { modulo: 'bitacora', ruta: '/bitacora/historial' },
  { modulo: 'documentos', ruta: '/documentos/plantillas' },
  { modulo: 'legal', ruta: '/legal/expedientes' },
  { modulo: 'direccion', ruta: '/direccion' },
  { modulo: 'admin', ruta: '/admin/usuarios' },
];

/** Rutas abiertas a todo usuario autenticado. */
export const OPEN_ROUTES = ['/dashboard', '/perfil', '/soporte', '/dudas', '/mensajes', '/tareas/mis-tareas'];

/** Log in via the UI; leaves the page on /dashboard. */
export async function login(page: Page, user: QaUser): Promise<void> {
  await page.goto('/auth');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
}

/** Attach console errors + failed network responses collectors to a page. */
export function collectPageErrors(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('response', (res) => {
    const s = res.status();
    // 401/403 esperados en pruebas de gating; registramos 5xx y 400/404/409/500 reales.
    if (s >= 500 || s === 400 || s === 404 || s === 409) {
      failedRequests.push(`${s} ${res.url().slice(0, 200)}`);
    }
  });
  return { consoleErrors, failedRequests };
}

export { expect };
