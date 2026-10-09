// CK5 — Guion: transferir un conduce y asignar "Entregar a" (Inventario → Salidas).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-transferir-conduce',
  plataforma: 'web',
  titulo: 'Transferir un conduce y asignar quién recibe',
  subtitulo: 'Cambia el chofer o el receptor de la obra',
  cierre: 'Conduce transferido',
  pasos: [
    { texto: 'Entra a Inventario → Salidas', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/inventario/salidas`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1200); await dismissModales(page);
    } },
    { texto: 'Abre el conduce de una salida', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('link', { name: /Conduce/i }).first();
      if (await b.count()) { await ring(b); await pausa(400); await b.click().catch(() => {}); }
      await pausa(1600); await dismissModales(page);
    } },
    { texto: 'Usa «Transferir» para pasarlo a otro chofer', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Transferir/i }).first();
      if (await b.count()) { await ring(b); }
      await pausa(1400);
    } },
    { texto: 'En «Entregar a» asigna o cambia el receptor', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Asignar|Cambiar/i }).first();
      if (await b.count()) { await ring(b); }
      await pausa(1500);
    } },
  ],
};
