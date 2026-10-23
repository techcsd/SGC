// _shared/odoo-client.ts — PoC "Odoo como fuente de verdad": cliente XML-RPC
// (execute_kw) de SOLO lectura para Odoo 17. Las credenciales salen únicamente
// de secrets del servidor (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY); nunca
// viajan al navegador. Errores traducidos a OdooError con un código estable.

export type OdooCodigo = "odoo_config" | "odoo_timeout" | "odoo_no_disponible" | "odoo_auth" | "odoo_error";

export class OdooError extends Error {
  constructor(public codigo: OdooCodigo, message: string) {
    super(message);
    this.name = "OdooError";
  }
}

// deno-lint-ignore no-explicit-any
export type XmlRpcValue = any;

export const TIMEOUT_MS = 15_000;

// ── Serialización XML-RPC ──────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function encodeValue(v: XmlRpcValue): string {
  if (v === null || v === undefined) return "<value><nil/></value>";
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new OdooError("odoo_error", "Número no válido en la petición.");
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === "string") return `<value><string>${esc(v)}</string></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(encodeValue).join("")}</data></array></value>`;
  if (typeof v === "object") {
    const miembros = Object.entries(v)
      .map(([k, val]) => `<member><name>${esc(k)}</name>${encodeValue(val)}</member>`)
      .join("");
    return `<value><struct>${miembros}</struct></value>`;
  }
  throw new OdooError("odoo_error", "Tipo no soportado en la petición.");
}

export function encodeCall(method: string, params: XmlRpcValue[]): string {
  return `<?xml version="1.0"?><methodCall><methodName>${esc(method)}</methodName><params>${
    params.map((p) => `<param>${encodeValue(p)}</param>`).join("")
  }</params></methodCall>`;
}

// ── Parseo de respuestas XML-RPC ───────────────────────────────────────────
const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

type Tok = { t: "open" | "close" | "self" | "text"; v: string };

function tokenize(xml: string): Tok[] {
  const toks: Tok[] = [];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w.]*)[^>]*?(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[2]) toks.push({ t: m[1] ? "close" : m[3] ? "self" : "open", v: m[2] });
    else if (m[4] !== undefined) toks.push({ t: "text", v: m[4] });
  }
  return toks;
}

export function parseResponse(xml: string): XmlRpcValue {
  const toks = tokenize(xml);
  let i = 0;
  const peek = () => toks[i];
  const expectOpen = (name: string) => {
    const k = toks[i++];
    if (!k || k.t !== "open" || k.v !== name) throw new OdooError("odoo_error", "Respuesta de Odoo no válida.");
  };
  const expectClose = (name: string) => {
    const k = toks[i++];
    if (!k || k.t !== "close" || k.v !== name) throw new OdooError("odoo_error", "Respuesta de Odoo no válida.");
  };
  const skipWs = () => { while (peek()?.t === "text" && !peek().v.trim()) i++; };

  function readValue(): XmlRpcValue {
    skipWs();
    expectOpen("value");
    skipWs();
    const k = peek();
    let out: XmlRpcValue;
    if (!k || k.t === "close") {
      out = ""; // <value></value>
    } else if (k.t === "text") {
      out = unesc(k.v); // <value>texto</value> = string
      i++;
    } else if (k.t === "self") {
      i++;
      out = k.v === "nil" ? null : "";
    } else {
      const tipo = k.v;
      i++;
      if (tipo === "array") {
        out = [];
        skipWs(); expectOpen("data"); skipWs();
        while (peek() && !(peek().t === "close" && peek().v === "data")) { out.push(readValue()); skipWs(); }
        expectClose("data"); skipWs(); expectClose("array");
      } else if (tipo === "struct") {
        out = {};
        skipWs();
        while (peek() && peek().t === "open" && peek().v === "member") {
          i++; skipWs(); expectOpen("name");
          const nombre = peek().t === "text" ? unesc(toks[i++].v) : "";
          expectClose("name");
          out[nombre] = readValue();
          skipWs(); expectClose("member"); skipWs();
        }
        expectClose("struct");
      } else {
        const txt = peek()?.t === "text" ? unesc(toks[i++].v) : "";
        expectClose(tipo);
        if (tipo === "int" || tipo === "i4" || tipo === "i8") out = Number(txt);
        else if (tipo === "double") out = Number(txt);
        else if (tipo === "boolean") out = txt.trim() === "1";
        else out = txt; // string, dateTime.iso8601, base64
      }
    }
    skipWs();
    expectClose("value");
    return out;
  }

  skipWs();
  expectOpen("methodResponse"); skipWs();
  const k = toks[i++];
  if (!k || k.t !== "open") throw new OdooError("odoo_error", "Respuesta de Odoo no válida.");
  if (k.v === "fault") {
    const f = readValue();
    throw new OdooError("odoo_error", faultCorto(f?.faultString));
  }
  if (k.v !== "params") throw new OdooError("odoo_error", "Respuesta de Odoo no válida.");
  skipWs(); expectOpen("param");
  return readValue();
}

/** Última línea útil del traceback de Odoo (sin rutas internas largas). */
function faultCorto(s: unknown): string {
  const txt = String(s ?? "Error de Odoo");
  const lineas = txt.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lineas[lineas.length - 1] ?? txt).slice(0, 300);
}

// ── Cliente ────────────────────────────────────────────────────────────────
export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  apiKey: string;
  companyId: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function configDesdeEntorno(): OdooConfig {
  const url = Deno.env.get("ODOO_URL");
  const db = Deno.env.get("ODOO_DB");
  const user = Deno.env.get("ODOO_USER");
  const apiKey = Deno.env.get("ODOO_API_KEY");
  if (!url || !db || !user || !apiKey) {
    throw new OdooError("odoo_config", "Falta configurar la conexión con Odoo en el servidor.");
  }
  const companyId = Number(Deno.env.get("ODOO_COMPANY_ID") ?? "1");
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new OdooError("odoo_config", "ODOO_COMPANY_ID no es válido.");
  }
  return { url: url.replace(/\/+$/, ""), db, user, apiKey, companyId };
}

export class OdooClient {
  private uid: number | null = null;
  readonly companyId: number;

  constructor(private cfg: OdooConfig) {
    this.companyId = cfg.companyId;
  }

  private async rpc(endpoint: "common" | "object", method: string, params: XmlRpcValue[]): Promise<XmlRpcValue> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? TIMEOUT_MS);
    let res: Response;
    try {
      res = await (this.cfg.fetchFn ?? fetch)(`${this.cfg.url}/xmlrpc/2/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body: encodeCall(method, params),
        signal: ctl.signal,
      });
      if (!res.ok) throw new OdooError("odoo_no_disponible", `Odoo respondió HTTP ${res.status}.`);
      return parseResponse(await res.text());
    } catch (e) {
      if (e instanceof OdooError) throw e;
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new OdooError("odoo_timeout", "Odoo no respondió a tiempo.");
      }
      throw new OdooError("odoo_no_disponible", "No se pudo conectar con Odoo.");
    } finally {
      clearTimeout(timer);
    }
  }

  private async autenticar(): Promise<number> {
    if (this.uid !== null) return this.uid;
    const uid = await this.rpc("common", "authenticate", [this.cfg.db, this.cfg.user, this.cfg.apiKey, {}]);
    if (typeof uid !== "number" || uid <= 0) {
      throw new OdooError("odoo_auth", "Odoo rechazó las credenciales de la cuenta técnica.");
    }
    this.uid = uid;
    return uid;
  }

  /** execute_kw. Solo lo invocan los módulos de acciones del gateway (allowlist). */
  async executeKw(model: string, method: string, args: XmlRpcValue[], kwargs: Record<string, XmlRpcValue> = {}): Promise<XmlRpcValue> {
    const uid = await this.autenticar();
    return this.rpc("object", "execute_kw", [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
  }
}
