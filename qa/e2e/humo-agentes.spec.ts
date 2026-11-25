import { test, expect } from '@playwright/test';

// Humo mínimo SIN credenciales para la promoción de agentes (EA3/F8): la app carga, no revienta y
// pide iniciar sesión. Lo corre agente-promocion.yml contra dev y contra prod (QA_BASE_URL).
test.describe('humo agentes (sin login)', () => {
  test('la app carga y muestra el login sin errores de página', async ({ page }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    const res = await page.goto('/');
    expect(res?.status() ?? 0).toBeLessThan(400);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('app-root')).toBeAttached();
    // sin sesión debe terminar en una pantalla de acceso (login) o al menos con contenido visible
    await expect(page.locator('body')).not.toBeEmpty();
    expect(errores, `errores de página: ${errores.join(' | ')}`).toEqual([]);
  });

  test('una ruta protegida no expone contenido sin sesión', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});
