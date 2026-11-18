// odoo-staging.mjs -- cliente XML-RPC minimo para los scripts DS (data-fixes / soak / limpieza).
// Lee SGC_INTEGRATION_ODOO_{URL,DB,USER,API_KEY} de .env.local (nunca imprime valores).
// GUARDIA DS-02: las escrituras solo salen si el host esta en ODOO_HOSTS_ESCRITURA (o en SGC_ODOO_HOSTS_ESCRITURA local).
import './load-env.mjs';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const enc = (v) => v === null || v === undefined ? '<value><nil/></value>'
  : typeof v === 'boolean' ? `<value><boolean>${v ? 1 : 0}</boolean></value>`
  : typeof v === 'number' ? (Number.isInteger(v) ? `<value><int>${v}</int></value>` : `<value><double>${v}</double></value>`)
  : typeof v === 'string' ? `<value><string>${esc(v)}</string></value>`
  : Array.isArray(v) ? `<value><array><data>${v.map(enc).join('')}</data></array></value>`
  : `<value><struct>${Object.entries(v).map(([k, x]) => `<member><name>${k}</name>${enc(x)}</member>`).join('')}</struct></value>`;
const un = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parse(xml) {
  const toks = []; const re = /<(\/?)([A-Za-z][\w.]*)[^>]*?(\/?)>|<\?[\s\S]*?\?>|([^<]+)/g; let m;
  while ((m = re.exec(xml))) { if (m[2]) toks.push({ t: m[1] ? 'c' : m[3] ? 's' : 'o', n: m[2] }); else if (m[4] !== undefined) toks.push({ t: 'x', v: m[4] }); }
  let i = 0;
  const ws = () => { while (toks[i] && toks[i].t === 'x' && !toks[i].v.trim()) i++; };
  function val() {
    ws(); i++; ws(); const t = toks[i]; let out;
    if (t.t === 'x') { out = un(t.v); i++; }
    else if (t.t === 'c') out = '';
    else if (t.t === 's') { i++; out = null; }
    else {
      i++; const n = t.n;
      if (n === 'array') { out = []; ws(); i++; ws(); while (!(toks[i].t === 'c' && toks[i].n === 'data')) { out.push(val()); ws(); } i++; ws(); i++; }
      else if (n === 'struct') {
        out = {}; ws();
        while (toks[i].t === 'o' && toks[i].n === 'member') { i++; ws(); i++; const k = toks[i].t === 'x' ? un(toks[i++].v) : ''; i++; out[k] = val(); ws(); i++; ws(); }
        i++;
      } else { const tx = toks[i].t === 'x' ? un(toks[i++].v) : ''; i++; out = ['int', 'i4', 'i8', 'double'].includes(n) ? Number(tx) : n === 'boolean' ? tx.trim() === '1' : tx; }
    }
    ws(); i++; return out;
  }
  ws(); i++; ws(); const k = toks[i++];
  if (k.n === 'fault') { const f = val(); throw new Error(String(f.faultString).split('\n').filter(Boolean).pop().slice(0, 160)); }
  ws(); i++; return val();
}
const E = (k) => process.env[`SGC_INTEGRATION_ODOO_${k}`];
export function hostStaging() { return new URL(E('URL')).host; }
export async function conectar({ escritura = false } = {}) {
  for (const k of ['URL', 'DB', 'USER', 'API_KEY']) if (!E(k)) throw new Error(`Falta SGC_INTEGRATION_ODOO_${k} en .env.local`);
  const host = hostStaging();
  const permitidos = (process.env.ODOO_HOSTS_ESCRITURA || process.env.SGC_ODOO_HOSTS_ESCRITURA || host).split(',').map((s) => s.trim().toLowerCase());
  if (escritura && !permitidos.includes(host.toLowerCase())) throw new Error('Escritura bloqueada: host no autorizado (DS-02).');
  const post = async (ep, m, p) => parse(await (await fetch(E('URL').replace(/\/+$/, '') + '/xmlrpc/2/' + ep, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: `<?xml version="1.0"?><methodCall><methodName>${m}</methodName><params>${p.map((v) => `<param>${enc(v)}</param>`).join('')}</params></methodCall>`, redirect: 'error' })).text());
  const uid = await post('common', 'authenticate', [E('DB'), E('USER'), E('API_KEY'), {}]);
  if (!uid) throw new Error('Odoo rechazo las credenciales');
  const kw = (model, method, args = [], kwargs = {}) => post('object', 'execute_kw', [E('DB'), uid, E('API_KEY'), model, method, args, kwargs]);
  return { uid, kw, host };
}
