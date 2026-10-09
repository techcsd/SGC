// CK5 — Guion: registrar un mantenimiento (Flota → Mantenimientos).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-registrar-mantenimiento',
  plataforma: 'web',
  titulo: 'Registrar un mantenimiento',
  subtitulo: 'Taller, kilometraje y factura del vehículo',
  cierre: 'Mantenimiento registrado',
  pasos: [
    { texto: 'Entra a Flota → Mantenimientos', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/flota/mantenimientos`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1300); await dismissModales(page);
    } },
    { texto: 'Toca «Nuevo mantenimiento»', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Nuevo mantenimiento|Registrar|Nuevo/i }).first();
      await ring(b); await pausa(400); await b.click().catch(() => {}); await pausa(1300);
    } },
    { texto: 'Elige el vehículo y el taller (o «Otro»)', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Escribe el kilometraje (se valida que sea coherente)', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Adjunta la factura o el informe y guarda', run: async ({ page, pausa }) => { await pausa(1500); } },
  ],
};
