// Cliente mínimo de las RPC del Ingeniero (PostgREST, esquema sgc) contra el proyecto DEV.
//   node scripts/guardianes/rpc.mjs ing_tarea_leer '{"p_id":"<uuid>"}'
// Variables (secrets del Environment `agentes-dev`; aquí solo se usan sus NOMBRES, nunca se imprimen valores):
//   SUPABASE_URL_DEV, SUPABASE_SERVICE_ROLE_KEY_DEV
// Si faltan -> sale con código 3 y escribe «inerte: faltan secrets» (el workflow lo trata como verde/inerte).
import { pathToFileURL } from 'node:url';

export const RPC_PERMITIDAS = new Set([
  'ing_tarea_leer', 'ing_tarea_actualizar', 'ing_evento_registrar', 'ing_config_leer', 'ing_zona_roja_crear_aprobacion',
]);

export function faltantes(env = process.env) {
  return ['SUPABASE_URL_DEV', 'SUPABASE_SERVICE_ROLE_KEY_DEV'].filter((n) => !env[n]);
}

export async function llamarRpc(fn, args = {}, { env = process.env, fetchFn = fetch } = {}) {
  if (!RPC_PERMITIDAS.has(fn)) throw new Error(`RPC no permitida: ${fn}`);
  const falta = faltantes(env);
  if (falta.length) { const e = new Error(`inerte: faltan secrets (${falta.join(', ')})`); e.inerte = true; throw e; }
  const base = env.SUPABASE_URL_DEV.replace(/\/+$/, '');
  const res = await fetchFn(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY_DEV,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY_DEV}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'sgc',
      'Accept-Profile': 'sgc',
    },
    body: JSON.stringify(args),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`RPC ${fn} -> HTTP ${res.status}: ${texto.slice(0, 300)}`);
  try { return texto ? JSON.parse(texto) : null; } catch { return texto; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [fn, json] = process.argv.slice(2);
  try {
    const out = await llamarRpc(fn, json ? JSON.parse(json) : {});
    console.log(JSON.stringify(out));
  } catch (e) {
    console.error(e.message);
    process.exit(e.inerte ? 3 : 1);
  }
}
