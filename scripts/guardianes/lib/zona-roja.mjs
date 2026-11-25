// G1 — clasificador de zona roja. Zona roja => se detiene en dev y crea aprobación humana.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revisarSql } from './sql-linter.mjs';

export function cargarZonaRoja(ruta = fileURLToPath(new URL('../zona-roja.json', import.meta.url))) {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

// cambios: [{ ruta, lineasAgregadas }] -> { esZonaRoja, categorias: [{id, etiqueta, razones[]}] }
export function clasificarZonaRoja(cambios, config = cargarZonaRoja()) {
  const mapa = new Map();
  const agrega = (id, etiqueta, razon) => {
    if (!mapa.has(id)) mapa.set(id, { id, etiqueta, razones: [] });
    const m = mapa.get(id);
    if (!m.razones.includes(razon)) m.razones.push(razon);
  };
  const etiquetas = Object.fromEntries(config.categorias.map((c) => [c.id, c.etiqueta]));
  for (const c of cambios) {
    const ruta = c.ruta.replace(/\\/g, '/').toLowerCase();
    for (const cat of config.categorias) {
      for (const re of cat.rutas) if (new RegExp(re, 'i').test(ruta)) agrega(cat.id, cat.etiqueta, `ruta ${c.ruta}`);
      for (const re of cat.contenido) {
        if ((c.lineasAgregadas ?? []).some((l) => new RegExp(re, 'i').test(l))) agrega(cat.id, cat.etiqueta, `contenido en ${c.ruta}`);
      }
    }
  }
  // migraciones: destructivas o que cambian RLS/permisos/roles
  const sql = revisarSql(cambios);
  for (const z of sql.zonaRoja) {
    agrega(z.categoria, etiquetas[z.categoria] ?? 'Migración destructiva', z.detalle);
  }
  const categorias = [...mapa.values()];
  return { esZonaRoja: categorias.length > 0, categorias };
}
