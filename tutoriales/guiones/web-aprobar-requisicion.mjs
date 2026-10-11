// CK5/CM3 — Guion: aprobar y despachar una requisición (Inventario → Requisiciones).
// Usa la capa "director" (cursor que se desliza, close-ups con zoom, spotlight).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-aprobar-requisicion',
  plataforma: 'web',
  titulo: 'Aprobar y despachar una requisición',
  subtitulo: 'Despacha lo disponible y pide lo que falta',
  cierre: 'Requisición despachada',
  pasos: [
    {
      texto: 'Entra a Inventario → Requisiciones',
      voz: 'Primero, entra al módulo de Inventario y abre la sección de Requisiciones.',
      run: async ({ page, pausa, foco, desfoco }) => {
        await page.goto(`${origin(page)}/inventario/requisiciones`, { waitUntil: 'networkidle', timeout: 45000 });
        await pausa(1200); await dismissModales(page);
        const h = page.getByRole('heading', { name: /Requisici/i }).first();
        if (await h.count()) { await foco(h, { zoom: 1.22 }); await pausa(700); await desfoco(); }
      },
    },
    {
      texto: 'Abre una requisición pendiente',
      voz: 'Busca una requisición que esté pendiente y ábrela para atenderla.',
      run: async ({ page, pausa, click, mover }) => {
        const b = page.getByRole('button', { name: /Aprobar|Atender|Despachar|Ver|Abrir/i }).first();
        if (await b.count()) { await click(b, { zoom: 1.35 }); await pausa(1300); }
        else { await mover(page.locator('body')); await pausa(1200); }
      },
    },
    {
      texto: 'Mapea cada renglón a un artículo del catálogo',
      voz: 'Relaciona cada renglón de la requisición con un artículo del catálogo del inventario.',
      run: async ({ page, pausa, foco, desfoco }) => {
        const sel = page.locator('select, [role="combobox"], input[type="search"]').first();
        if (await sel.count()) { await foco(sel, { zoom: 1.4 }); await pausa(1200); await desfoco(); }
        else await pausa(1300);
      },
    },
    {
      texto: 'Elige el almacén desde el que se despacha',
      voz: 'Luego elige desde qué almacén vas a despachar el material disponible.',
      run: async ({ page, pausa, foco, desfoco }) => {
        const alm = page.getByText(/almac[eé]n/i).first();
        if (await alm.count()) { await foco(alm, { zoom: 1.35 }); await pausa(1100); await desfoco(); }
        else await pausa(1200);
      },
    },
    {
      texto: 'Aprueba: despacho + compra del faltante',
      voz: 'Al aprobar, el sistema despacha lo que hay y manda a comprar lo que falta. Así de fácil.',
      run: async ({ page, pausa, foco }) => {
        const ap = page.getByRole('button', { name: /^Aprobar|Confirmar|Despachar/i }).last();
        if (await ap.count()) { await foco(ap, { zoom: 1.3 }); await pausa(1100); }
        else await pausa(1200);
      },
    },
  ],
};
