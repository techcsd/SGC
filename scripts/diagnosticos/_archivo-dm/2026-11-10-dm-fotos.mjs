import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
import { writeFileSync } from 'node:fs';

const env = await resolverEnv(process.argv.slice(2));
const OUT = process.argv[process.argv.length - 1];

const fotos = {
  '28e423b1': '7c7ffd84-5c74-48d3-9084-5dad7202857b/28e423b1-8ea9-41b7-9755-a6d9f4f62feb/a53e68f5-d467-47c7-a140-cb99d508b975.jpg',
  '1a91a8cd': '7c7ffd84-5c74-48d3-9084-5dad7202857b/1a91a8cd-942a-4179-ae42-db3a4ce37bbb/ca675f3c-5841-4183-9aaf-34a32bb8eb62.jpg',
  'c1102070': '7c7ffd84-5c74-48d3-9084-5dad7202857b/c1102070-bae5-436d-bb62-6478e013788f/e6df641b-dc13-431c-b125-f974ebbad75e.jpg',
  '1e56426e': '7c7ffd84-5c74-48d3-9084-5dad7202857b/1e56426e-2f76-44c4-8548-d92f36b01b08/3408d898-47c4-41e4-ba78-5c230859f99f.jpg',
};

for (const [id, path] of Object.entries(fotos)) {
  const res = await fetch(`${env.url}/storage/v1/object/sign/reportes/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const json = await res.json();
  if (!json.signedURL) { console.log(id, 'ERROR', JSON.stringify(json)); continue; }
  const full = `${env.url}/storage/v1${json.signedURL}`;
  const imgRes = await fetch(full);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(`${OUT}/${id}.jpg`, buf);
  console.log(id, 'ok', buf.length, 'bytes');
}
