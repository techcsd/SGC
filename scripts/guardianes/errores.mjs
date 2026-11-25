// Fuente de "errores nuevos en 10 min vs línea base" para la verificación posterior a prod.
//   node scripts/guardianes/errores.mjs base|ahora      -> imprime un número (conteo) en stdout
// Lee un endpoint de SOLO LECTURA que devuelva { "ultimos_10min": N, "previos_10min": M } (p. ej. una edge function
// de conteo expuesta por Tecnología; NO es la service role de prod). Env: ERRORES_CONTEO_URL, ERRORES_CONTEO_TOKEN (opcional).
// Si no está configurado -> exit 3 («sin dato») y el workflow decide solo con health+smoke, dejándolo anotado.
const modo = process.argv[2];
const url = process.env.ERRORES_CONTEO_URL;
if (!url) { console.error('inerte: falta ERRORES_CONTEO_URL (sin dato de errores)'); process.exit(3); }
const r = await fetch(url, { headers: process.env.ERRORES_CONTEO_TOKEN ? { Authorization: `Bearer ${process.env.ERRORES_CONTEO_TOKEN}` } : {} });
if (!r.ok) { console.error(`conteo HTTP ${r.status}`); process.exit(1); }
const j = await r.json();
console.log(modo === 'base' ? Number(j.previos_10min) : Number(j.ultimos_10min));
