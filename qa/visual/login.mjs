// qa/visual/login.mjs — abre un navegador para que Xaviel entre UNA vez y guarda
// la sesión en qa/visual/.auth.json, que luego usa capturar.mjs para recorrer
// todas las rutas autenticadas. (El authGuard protege casi todo — sin esto solo
// se pueden capturar /auth y /auth/set-password.)
//
// USO:  node qa/visual/login.mjs [--base http://localhost:4200]
//   1) se abre Chrome, entra como admin en dev,
//   2) cuando el dashboard cargue, vuelve a la terminal y pulsa Enter.

import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--base');
const BASE = i >= 0 ? args[i + 1] : process.env.SGC_QA_BASE || 'http://localhost:4200';
const AUTH_STATE = join(__dirname, '.auth.json');

const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth`);
  console.log('\n➡  Entra como admin en la ventana que se abrió. Cuando veas el dashboard, vuelve aquí.');
  await ask('   Pulsa Enter para guardar la sesión…');
  await ctx.storageState({ path: AUTH_STATE });
  console.log(`✓ Sesión guardada en ${AUTH_STATE}. Ya puedes: node qa/visual/capturar.mjs antes`);
  await browser.close();
})();
