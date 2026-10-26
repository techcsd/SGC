// CY20 — confirma que PostgREST sirve las tablas extendidas sin romper
// (schema cache recargado, columnas nuevas visibles, lectura anon sigue bloqueada por RLS).
import '../lib/load-env.mjs';
const url = process.env.SUPABASE_URL_DEV;
const anon = process.env.SUPABASE_ANON_KEY_DEV;
const tablas = ['articulos', 'proveedores', 'bodegas', 'ordenes_compra', 'orden_compra_items', 'categorias_inventario', 'unidades'];
for (const t of tablas) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Accept-Profile': 'sgc' } });
  console.log(t, '->', r.status, r.status === 200 || r.status === 401 || r.status === 406 ? 'OK (sin 500/PGRST)' : 'REVISAR');
}
