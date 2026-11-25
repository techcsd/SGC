// Chequeos de salud para promoción/verificación. Solo lectura. Sin secrets en la salida.
//   node scripts/guardianes/salud.mjs health --url https://sgcconstructorasd.com [--reintentos 10]
//   node scripts/guardianes/salud.mjs vercel-listo --sha <commit> [--target production|preview] [--reintentos 30]
//        env: VERCEL_TOKEN_AGENTES (token acotado al proyecto, solo lectura), VERCEL_PROJECT_ID, VERCEL_TEAM_ID (opcional)
// Exit: 0 ok, 1 falla, 3 inerte (faltan secrets/variables).
const [cmd, ...rest] = process.argv.slice(2);
const arg = (n, d) => { const i = rest.indexOf(`--${n}`); return i > -1 ? rest[i + 1] : d; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function health(url, reintentos) {
  for (let i = 1; i <= reintentos; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      const html = await r.text();
      // La SPA debe responder 200 y servir el bundle (app-root); un 5xx o página vacía = no sano.
      if (r.ok && /<app-root|<script/i.test(html)) { console.log(`health ok (${r.status}) intento ${i}`); return true; }
      console.log(`health intento ${i}: HTTP ${r.status}`);
    } catch (e) { console.log(`health intento ${i}: ${e.message}`); }
    await dormir(15_000);
  }
  return false;
}

async function vercelListo(sha, target, reintentos) {
  const { VERCEL_TOKEN_AGENTES: token, VERCEL_PROJECT_ID: proyecto, VERCEL_TEAM_ID: equipo } = process.env;
  if (!token || !proyecto) { console.error('inerte: faltan secrets (VERCEL_TOKEN_AGENTES, VERCEL_PROJECT_ID)'); process.exit(3); }
  for (let i = 1; i <= reintentos; i++) {
    const q = new URLSearchParams({ projectId: proyecto, limit: '20', ...(target ? { target } : {}), ...(equipo ? { teamId: equipo } : {}) });
    const r = await fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const { deployments = [] } = await r.json();
      const d = deployments.find((x) => (x.meta?.githubCommitSha ?? '').startsWith(sha.slice(0, 7)));
      if (d) {
        console.log(`deployment ${d.uid ?? ''} estado ${d.state ?? d.readyState}`);
        if ((d.state ?? d.readyState) === 'READY') return true;
        if (['ERROR', 'CANCELED'].includes(d.state ?? d.readyState)) return false;
      } else console.log(`intento ${i}: aún no hay deployment para ${sha.slice(0, 7)}`);
    } else console.log(`intento ${i}: Vercel HTTP ${r.status}`);
    await dormir(20_000);
  }
  return false;
}

let ok = false;
if (cmd === 'health') ok = await health(arg('url'), Number(arg('reintentos', 10)));
else if (cmd === 'vercel-listo') ok = await vercelListo(arg('sha'), arg('target'), Number(arg('reintentos', 30)));
else { console.error('Uso: salud.mjs health|vercel-listo ...'); process.exit(1); }
process.exit(ok ? 0 : 1);
