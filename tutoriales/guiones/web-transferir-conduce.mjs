// CK5 — Guion: transferir un conduce y asignar "Entregar a".
// Las listas ocultan los datos de prueba a los no-admin (toggle admin-only), así que para
// mostrar un conduce real de demo navegamos directo a su ficha por id. El id es el del
// conduce demo sembrado en dev (OBRA DEMO); si se re-siembra, actualízalo. Override con
// TUTORIAL_DEMO_CONDUCE_ID.
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');
const DEMO_CONDUCE = process.env.TUTORIAL_DEMO_CONDUCE_ID || '426fa75d-a9e1-4937-867a-e92805ffea09';

export default {
  id: 'web-transferir-conduce',
  plataforma: 'web',
  titulo: 'Transferir un conduce y asignar quién recibe',
  subtitulo: 'Cambia el chofer o el receptor de la obra',
  cierre: 'Conduce transferido',
  pasos: [
    { texto: 'Abre el conduce (Inventario → Salidas → Conduce)', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/inventario/salidas/${DEMO_CONDUCE}/conduce`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1600); await dismissModales(page);
    } },
    { texto: 'Revisa el detalle del conduce', run: async ({ page, pausa }) => { await pausa(1600); } },
    { texto: 'Usa «Transferir» para pasarlo a otro chofer', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Transferir/i }).first();
      if (await b.count()) { await ring(b); }
      await pausa(1600);
    } },
    { texto: 'En «Entregar a» asigna o cambia el receptor', run: async ({ page, ring, pausa }) => {
      const b = page.getByRole('button', { name: /Asignar|Cambiar/i }).first();
      if (await b.count()) { await ring(b); }
      await pausa(1700);
    } },
  ],
};
