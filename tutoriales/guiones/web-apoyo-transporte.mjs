// CK5 — Guion: crear un apoyo de transporte (web). Flujo verificado end-to-end.
import { dismissModales } from '../lib/record.mjs';

export default {
  id: 'web-apoyo-transporte',
  plataforma: 'web',
  titulo: 'Crear un apoyo de transporte',
  subtitulo: 'Pide que muevan material desde la obra',
  cierre: 'Apoyo creado',
  pasos: [
    {
      texto: 'Entra a Transporte › Apoyo de transporte',
      run: async ({ page, pausa }) => {
        await page.goto(`${page.url().split('/').slice(0, 3).join('/')}/transporte/apoyo`, { waitUntil: 'networkidle', timeout: 45000 });
        await pausa(1200);
        await dismissModales(page);
      },
    },
    {
      texto: 'Toca «Nuevo apoyo»',
      run: async ({ page, ring, pausa }) => {
        const b = page.getByRole('button', { name: /Nuevo apoyo/i });
        await ring(b); await pausa(400); await b.click(); await pausa(1200);
      },
    },
    {
      texto: 'Elige el tipo: Movimiento interno',
      run: async ({ page, ring, pausa }) => {
        const t = page.locator('.apoyo-tipo').filter({ hasText: 'Movimiento interno' });
        if (await t.count()) { await ring(t.first()); await t.first().click(); await pausa(700); }
      },
    },
    {
      texto: 'Selecciona la obra',
      run: async ({ page, obraDemo, pausa }) => {
        await page.locator('#ap-obra').selectOption({ label: obraDemo }).catch(async () => {
          await page.locator('#ap-obra').selectOption({ index: 1 }).catch(() => {});
        });
        await pausa(600);
      },
    },
    {
      texto: 'Escribe qué hay que mover',
      run: async ({ page, pausa }) => {
        await page.locator('#ap-desc').fill('20 sacos de cemento sobrantes del 3er nivel');
        await pausa(800);
      },
    },
    {
      texto: 'Sube una foto de lo que se va a mover',
      run: async ({ page, pausa }) => {
        await page.locator('input[type="file"]').first().setInputFiles('assets/demo-foto.jpg').catch(() => {});
        await pausa(1500);
      },
    },
    {
      texto: 'Toca «Crear apoyo» — listo',
      run: async ({ page, ring, pausa }) => {
        const c = page.getByRole('button', { name: /Crear apoyo/i });
        await ring(c); await pausa(400); await c.click().catch(() => {}); await pausa(2500);
      },
    },
  ],
};
