// CK5 — Guion: autorizar un chofer privado (Flota → Choferes privados).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-autorizar-chofer-privado',
  plataforma: 'web',
  titulo: 'Autorizar un chofer privado',
  subtitulo: 'Dale acceso a vehículos seleccionados',
  cierre: 'Chofer privado autorizado',
  pasos: [
    { texto: 'Entra a Flota → Conductores → Choferes privados', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/flota/choferes-privados`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1300); await dismissModales(page);
    } },
    { texto: 'En el chofer, toca «Autorizar vehículos»', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Autorizar vehículos|Autorizar/i }).first();
      if (await b.count()) { await ring(b); await pausa(400); await b.click().catch(() => {}); }
      await pausa(1400);
    } },
    { texto: 'Elige uno o varios vehículos', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Opcional: una fecha de vigencia', run: async ({ page, pausa }) => { await pausa(1300); } },
    { texto: 'Guarda: ya puede tomar y soltar esos vehículos', run: async ({ page, pausa }) => { await pausa(1500); } },
  ],
};
