import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const secretRes = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret';` }),
});
const [{ decrypted_secret }] = await secretRes.json();
const res = await fetch(`${env.url}/functions/v1/agente-pendientes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sync-secret': decrypted_secret },
  body: JSON.stringify({ modo: 'prueba', usuario_id: '4b19cc4b-3dbe-40dc-8631-ef489cad0f45' }),
});
console.log(res.status, await res.text());
