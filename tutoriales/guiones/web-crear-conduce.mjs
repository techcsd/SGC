// CK5 — Guion: crear un conduce (Inventario → Salidas). Estilo demostrativo (abre el
// formulario y lo muestra; no envía, para no crear datos). Ajusta selectores al grabar.
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-crear-conduce',
  plataforma: 'web',
  titulo: 'Crear un conduce',
  subtitulo: 'Registra una salida de material a la obra',
  cierre: 'Así se crea un conduce',
  pasos: [
    { texto: 'Entra a Inventario → Salidas', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/inventario/salidas`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1200); await dismissModales(page);
    } },
    { texto: 'Toca «Registrar salida»', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Registrar salida|Nueva salida|Nuevo/i }).first();
      await ring(b); await pausa(400); await b.click().catch(() => {}); await pausa(1200);
    } },
    { texto: 'Elige el almacén y la obra de destino', run: async ({ page, pausa }) => { await pausa(1400); } },
    { texto: 'Agrega los artículos y las cantidades', run: async ({ page, pausa }) => { await pausa(1400); } },
    { texto: 'Al guardar se genera el conduce CND-…', run: async ({ page, pausa }) => { await pausa(1400); } },
  ],
};
