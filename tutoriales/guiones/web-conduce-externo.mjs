// CK5 — Guion: conduce externo desde una requisición (Inventario → Conduce externo).
import { dismissModales } from '../lib/record.mjs';
const origin = (page) => page.url().split('/').slice(0, 3).join('/');

export default {
  id: 'web-conduce-externo',
  plataforma: 'web',
  titulo: 'Conduce externo desde una requisición',
  subtitulo: 'Material que llega por un transportista externo',
  cierre: 'Conduce externo listo',
  pasos: [
    { texto: 'Entra a Inventario → Conduce externo → Nuevo', run: async ({ page, pausa }) => {
      await page.goto(`${origin(page)}/inventario/conduce-externo/nuevo`, { waitUntil: 'networkidle', timeout: 45000 });
      await pausa(1300); await dismissModales(page);
    } },
    { texto: 'Elige el proveedor de transporte y la obra', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Escribe lo que llega y la placa del vehículo', run: async ({ page, pausa }) => { await pausa(1500); } },
    { texto: 'Sube la foto del material recibido', run: async ({ page, pausa }) => { await pausa(1400); } },
    { texto: 'Al confirmar, entra al inventario de la obra', run: async ({ page, pausa }) => { await pausa(1500); } },
  ],
};
