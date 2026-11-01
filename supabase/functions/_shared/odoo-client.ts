// _shared/odoo-client.ts — PoC "Odoo como fuente de verdad": conector genérico
// hacia Odoo 17. `OdooClient.call(model, method, args, kwargs)` es la única
// operación; QUÉ se puede llamar lo decide una `PoliticaOdoo` inyectada (allowlist
// modelo → métodos de lectura / escritura), no el código del cliente. El
// transporte (`TransporteOdoo`: hoy XML-RPC execute_kw de Odoo 17) es
// intercambiable: si algún día se migra a Odoo >= 19 (JSON-2) solo cambia el
// transporte. Las lecturas reautentican una vez; las ESCRITURAS jamás se
// reintentan (el reintento lo hace el usuario; es seguro por idempotencia).
// Las credenciales salen únicamente de secrets del servidor (ODOO_URL, ODOO_DB,
// ODOO_USER, ODOO_API_KEY); nunca viajan al navegador. Errores traducidos a
// OdooError con un código estable.

export type OdooCodigo =
  | "odoo_config"
  | "odoo_timeout"
  | "odoo_no_disponible"
  | "odoo_auth"
  | "odoo_error"
  | "odoo_circuito_abierto" // CY23: demasiados fallos recientes, se deja de intentar un rato
  | "odoo_saturado"; // CY23: demasiadas consultas simultáneas (semáforo global lleno)

export class OdooError extends Error {
  /** `fault`: Odoo respondió con un fault XML-RPC (rechazo de negocio, la transacción se revirtió); false = falla de transporte/formato. */
  constructor(public codigo: OdooCodigo, message: string, public fault = false) {
    super(message);
    this.name = "OdooError";
  }
}

// deno-lint-ignore no-explicit-any
export type XmlRpcValue = any;

export const TIMEOUT_MS = 15_000;

// ── Serialización XML-RPC ──────────────────────────────────────────────────
// Quita caracteres no válidos en XML 1.0 (control, surrogates sueltos): Odoo rechazaría el documento entero.
const limpiaXml = (s: string) =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
const esc = (s: string) => limpiaXml(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
const codePointSeguro = (n: number): string =>
  Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\uFFFD";

const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePointSeguro(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePointSeguro(Number(n)))
    .replace(/&amp;/g, "&");

/** Odoo (marshal de Python) no emite CDATA, pero otros proxies sí: lo normalizamos a texto escapado. */
const sinCdata = (xml: string) => xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => esc(t));

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
  const toks = tokenize(sinCdata(xml));
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
        if (tipo === "int" || tipo === "i4" || tipo === "i8" || tipo === "double") {
          const n = txt.trim() === "" ? NaN : Number(txt);
          if (!Number.isFinite(n) || (tipo !== "double" && !Number.isSafeInteger(n))) {
            throw new OdooError("odoo_error", "Respuesta de Odoo no válida.");
          }
          out = n;
        }
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
    throw new OdooError("odoo_error", faultCorto(f?.faultString), true);
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
  /** Allowlist de llamadas. Por defecto POLITICA_POR_DEFECTO (lo que usa el gateway). */
  politica?: PoliticaOdoo;
  /** Transporte alternativo (p. ej. JSON-2 en Odoo >= 19). Por defecto XML-RPC. */
  transporte?: TransporteOdoo;
}

/** Allowlist modelo → métodos. Vive en el servidor: el navegador nunca elige modelo ni método. */
export interface PoliticaOdoo {
  lectura: Readonly<Record<string, readonly string[]>>;
  escritura: Readonly<Record<string, readonly string[]>>;
}

/** Lo que usa el gateway hoy. Ampliarla es un cambio de código revisado. */
export const POLITICA_POR_DEFECTO: PoliticaOdoo = {
  lectura: {
    "product.product": ["search_read"],
    "stock.location": ["search_read"],
    "stock.quant": ["read_group"],
    "res.partner": ["search_read"],
    "purchase.order": ["search_read"],
    "stock.picking": ["search_read"],
  },
  escritura: {
    "purchase.order": ["create", "button_confirm", "button_cancel"],
    // Proveedores directos en Odoo: alta y edición/archivado. Sin unlink: nunca se borra un partner.
    "res.partner": ["create", "write"],
  },
};

/** Contrato mínimo de un transporte hacia Odoo. */
export interface TransporteOdoo {
  /** `escritura` = una sola vez, sin reautenticar ni reenviar. */
  call(model: string, method: string, args: XmlRpcValue[], kwargs: Record<string, XmlRpcValue>, escritura: boolean): Promise<XmlRpcValue>;
  version(): Promise<XmlRpcValue>;
}

/** https obligatorio (la API key viaja en el body); http solo contra localhost en desarrollo. */
export function validarUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new OdooError("odoo_config", "ODOO_URL no es una URL válida."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new OdooError("odoo_config", "ODOO_URL debe usar https.");
  }
  return raw.replace(/\/+$/, "");
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
  return { url: validarUrl(url), db, user, apiKey, companyId };
}

const RX_ACCESS_DENIED = /AccessDenied|Access Denied/i;

/** Transporte XML-RPC (execute_kw) de Odoo 17: autenticación, timeout y reglas de reintento. */
export class TransporteXmlRpc implements TransporteOdoo {
  private uid: number | null = null;
  private autenticando: Promise<number> | null = null;

  constructor(private cfg: OdooConfig) {}

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
        redirect: "error", // nunca reenviar la API key a otro destino
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

  private autenticar(): Promise<number> {
    if (this.uid !== null) return Promise.resolve(this.uid);
    // Una sola autenticación en vuelo aunque lleguen N peticiones a un isolate frío.
    return this.autenticando ??= (async () => {
      try {
        const uid = await this.rpc("common", "authenticate", [this.cfg.db, this.cfg.user, this.cfg.apiKey, {}]);
        if (typeof uid !== "number" || uid <= 0) {
          throw new OdooError("odoo_auth", "Odoo rechazó las credenciales de la cuenta técnica.");
        }
        this.uid = uid;
        return uid;
      } finally {
        this.autenticando = null;
      }
    })();
  }

  version(): Promise<XmlRpcValue> {
    return this.rpc("common", "version", []);
  }

  call(model: string, method: string, args: XmlRpcValue[], kwargs: Record<string, XmlRpcValue>, escritura: boolean): Promise<XmlRpcValue> {
    return escritura ? this.escribir(model, method, args, kwargs) : this.leer(model, method, args, kwargs);
  }

  private async leer(model: string, method: string, args: XmlRpcValue[], kwargs: Record<string, XmlRpcValue>): Promise<XmlRpcValue> {
    const llamar = async () =>
      this.rpc("object", "execute_kw", [this.cfg.db, await this.autenticar(), this.cfg.apiKey, model, method, args, kwargs]);
    try {
      return await llamar();
    } catch (e) {
      if (!(e instanceof OdooError) || !RX_ACCESS_DENIED.test(e.message)) throw e;
      // Clave rotada o uid caducado: reautentica UNA vez; si sigue fallando, es un problema de credenciales.
      this.uid = null;
      try { return await llamar(); } catch (e2) {
        if (e2 instanceof OdooError && RX_ACCESS_DENIED.test(e2.message)) {
          throw new OdooError("odoo_auth", "Odoo rechazó las credenciales de la cuenta técnica.");
        }
        throw e2;
      }
    }
  }

  /**
   * Escritura: UNA sola vez, jamás reintenta (ni backoff ni reautenticación que
   * reenvíe). Timeout/caída lanza odoo_timeout/odoo_no_disponible: el llamador lo
   * trata como error con reintento del usuario (los comandos son idempotentes).
   * Una respuesta ilegible tras enviar se trata igual (no se sabe si aplicó).
   * Un fault de Odoo (fault=true) es un rechazo cierto.
   */
  private async escribir(model: string, method: string, args: XmlRpcValue[], kwargs: Record<string, XmlRpcValue>): Promise<XmlRpcValue> {
    const uid = await this.autenticar(); // si falla aquí, todavía no se envió nada
    try {
      return await this.rpc("object", "execute_kw", [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
    } catch (e) {
      if (!(e instanceof OdooError)) throw e;
      if (e.fault && RX_ACCESS_DENIED.test(e.message)) {
        this.uid = null; // el próximo request reautentica; ESTE no se reenvía
        throw new OdooError("odoo_auth", "Odoo rechazó las credenciales de la cuenta técnica.");
      }
      if (e.codigo === "odoo_error" && !e.fault) {
        throw new OdooError("odoo_no_disponible", "Respuesta de Odoo ilegible tras una escritura: no se sabe si se aplicó.");
      }
      throw e;
    }
  }
}

/** Conector genérico: valida contra la política y delega en el transporte. */
export class OdooClient {
  readonly companyId: number;
  private politica: PoliticaOdoo;
  private transporte: TransporteOdoo;

  constructor(cfg: OdooConfig) {
    this.companyId = cfg.companyId;
    this.politica = cfg.politica ?? POLITICA_POR_DEFECTO;
    this.transporte = cfg.transporte ?? new TransporteXmlRpc(cfg);
  }

  version(): Promise<XmlRpcValue> {
    return this.transporte.version();
  }

  /** execute_kw genérico. La escritura se detecta por la política (no por el nombre del método). */
  call(model: string, method: string, args: XmlRpcValue[] = [], kwargs: Record<string, XmlRpcValue> = {}): Promise<XmlRpcValue> {
    const escritura = !!this.politica.escritura[model]?.includes(method);
    if (!escritura && !this.politica.lectura[model]?.includes(method)) {
      return Promise.reject(new OdooError("odoo_error", `Llamada no permitida: ${model}.${method}.`));
    }
    return this.transporte.call(model, method, args, kwargs, escritura);
  }

  /** Azúcar de lectura sobre `call`. */
  searchRead(model: string, dominio: XmlRpcValue[], fields: string[], opts: { limit?: number; order?: string } = {}): Promise<Record<string, XmlRpcValue>[]> {
    return this.call(model, "search_read", [dominio], { fields, ...opts });
  }
}
