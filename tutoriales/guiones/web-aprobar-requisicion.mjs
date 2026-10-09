// CK5 — Guion: aprobar y despachar una requisición (Inventario → Requisiciones).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-aprobar-requisicion',
  plataforma: 'web',
  titulo: 'Aprobar y despachar una requisición',
  subtitulo: 'Despacha lo disponible y pide lo que falta',
  cierre: 'Requisición despachada',
  pasos: [
    { texto: 'Entra a Inventario → Requisiciones', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/inventario/requisiciones`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1300); await dismissModales(page);
    } },
    { texto: 'Abre una requisición pendiente', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Aprobar|Atender|Despachar/i }).first();
      if (await b.count()) { await ring(b); await pausa(400); await b.click().catch(() => {}); }
      await pausa(1400);
    } },
    { texto: 'Mapea cada renglón a un artículo del catálogo', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Elige el almacén desde el que se despacha', run: async ({ page, pausa }) => { await pausa(1400); } },
    { texto: 'Aprueba: despacho + compra del faltante', run: async ({ page, pausa }) => { await pausa(1500); } },
  ],
};
