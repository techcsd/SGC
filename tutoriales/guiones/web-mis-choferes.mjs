// CK5 — Guion: Misael asigna un trabajo y sigue a sus choferes (Transporte).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-mis-choferes',
  plataforma: 'web',
  titulo: 'Asignar trabajos y seguir a tus choferes',
  subtitulo: 'La bandeja de Misael y el monitoreo en vivo',
  cierre: 'Así monitoreas a tus choferes',
  pasos: [
    { texto: 'Entra a Transporte → Trabajos de transporte', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/transporte/trabajos`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1400); await dismissModales(page);
    } },
    { texto: 'Cada tarjeta es un apoyo o conduce por asignar', run: async ({ page, pausa }) => { await pausa(1600); } },
    { texto: 'Asigna un chofer a un trabajo', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Asignar/i }).first();
      if (await b.count()) { await ring(b); }
      await pausa(1500);
    } },
    { texto: 'Entra a Transporte → Mis choferes', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/transporte/mis-choferes`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1500); await dismissModales(page);
    } },
    { texto: 'Ve el estado, el trabajo y la última señal', run: async ({ page, pausa }) => { await pausa(1700); } },
  ],
};
