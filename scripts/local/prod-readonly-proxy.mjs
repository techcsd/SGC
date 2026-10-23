// prod-readonly-proxy.mjs — proxy local que deja LEER prod y bloquea cualquier escritura.
// Permite: GET/HEAD/OPTIONS y POST solo a /auth/v1/token (login/refresh) y /auth/v1/logout.
// Bloquea (403 JSON): el resto de POST/PUT/PATCH/DELETE (rest, rpc, storage, functions) y websockets (realtime).
// El destino lo toma de src/environments/environment.prod.ts (no hay ref hardcodeado aquí).
//   npm run proxy:prod-ro        (puerto 54999, 127.0.0.1)
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const upstream = new URL(readFileSync(new URL('../../src/environments/environment.prod.ts', import.meta.url), 'utf8')
  .match(/supabaseUrl:\s*'([^']+)'/)[1]);
const PORT = Number(process.env.PROXY_PORT || 54999);
const OK_POST = [/^\/auth\/v1\/token(\?|$)/, /^\/auth\/v1\/logout(\?|$)/];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS' };

http.createServer((req, res) => {
  const permitido = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || (req.method === 'POST' && OK_POST.some((r) => r.test(req.url)));
  if (!permitido) {
    console.warn(`✋ bloqueado ${req.method} ${req.url.split('?')[0]}`);
    res.writeHead(403, { 'content-type': 'application/json', ...CORS });
    return res.end(JSON.stringify({ message: 'PROD SOLO LECTURA: escritura bloqueada por el proxy local (docs/ENTORNO-LOCAL.md).' }));
  }
  const headers = { ...req.headers, host: upstream.host };
  const up = https.request({ host: upstream.host, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502, CORS); res.end(String(e.message)); });
  req.pipe(up);
}).on('upgrade', (req, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); })
  .listen(PORT, '127.0.0.1', () => console.log(`\x1b[41m\x1b[97m PROD SOLO LECTURA \x1b[0m proxy http://127.0.0.1:${PORT} → ${upstream.origin}`));
