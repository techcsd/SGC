// dbq-dev.mjs -- helper de consulta SQL via Management API para los data-fixes DS (dry-run/solo lectura por defecto).
// Uso: import { consulta } from './lib/dbq-dev.mjs'; const rows = await consulta(env, 'select 1');
export async function consulta(env, query) {
  for (let a = 0; ; a++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.status === 429 && a < 6) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) throw new Error(text.slice(0, 400));
    try { return JSON.parse(text); } catch { return []; }
  }
}
