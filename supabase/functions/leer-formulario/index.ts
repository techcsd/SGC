import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { resolverSttConfig, transcribirAudio } from "../_shared/stt.ts";
import { validarRespuestasChecklist } from "./checklist.ts";

// ============================================================================
// DF1-B..E (ronda DF) — lector IA GENÉRICO para formularios que no son la
// bitácora (esa tiene su propia edge `bitacora-ia`, DF1-A). Un solo endpoint
// con parámetro `tipo` y un esquema de salida por tipo, en vez de una edge por
// formulario — mismo patrón de costo/consentimiento/catálogo que `bitacora-ia`
// y `leer-recibo`.
//
//   Entrada (POST, JWT del usuario):
//     { tipo: 'conduce_externo' | 'checklist_vehiculo' | 'requisicion' | 'factura_general' | 'mantenimiento' | 'ruta',
//       fotos?: [{ data: '<base64>', mime: 'image/jpeg' }],
//       transcripcion?: string,
//       proyecto_id?: string }
//   Salida (varía por tipo — ver TIPOS abajo): { ok, propuesta_id, ...campos, confianza_media, modelo }
//
//   'conduce_externo' (F2), 'mantenimiento' (F2b) y 'checklist_vehiculo' (F2b)
//   están implementados. 'requisicion' y 'ruta' quedan declarados (para que el
//   front los pueda listar) pero devuelven 501 — ver docs/IA-FLUJOS-ROLES.md §F2
//   para el plan de continuación.
//
//   'mantenimiento' acepta audio/transcripción en vez de fotos (voz: "se dañó el
//   motor del camión 5, hay que llevarlo al taller esta semana" → descripción +
//   vehículo sugerido + tipo preventivo/correctivo). Reusa _shared/stt.ts.
//
//   'checklist_vehiculo' acepta voz (+ fotos opcionales de daños) + `items`
//   (los ítems de la plantilla elegida, [{id, etiqueta, es_critico}] — NO es un
//   catálogo de la DB, depende de la plantilla del usuario) → respuesta ok/no
//   por ítem mencionado. El modelo solo puede usar los ids que llegaron en la
//   petición — defensa en profundidad server-side filtra cualquier otro.
//
//   Secrets: ANTHROPIC_API_KEY (obligatorio) · LEER_FORMULARIO_MODEL (opcional) ·
//            STT_API_KEY / STT_PROVIDER / STT_MODEL (para 'mantenimiento').
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LEER_FORMULARIO_MODEL") ?? Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Precio aproximado (USD/1M tokens) para el costo estimado — Haiku 4.5.
const PRECIO_IN = 1.0 / 1_000_000;
const PRECIO_OUT = 5.0 / 1_000_000;

// deno-lint-ignore no-explicit-any
type Any = any;

const TIPOS_IMPLEMENTADOS = new Set(["conduce_externo", "mantenimiento", "checklist_vehiculo"]);
const TIPOS_DECLARADOS = new Set([
  "conduce_externo", "checklist_vehiculo", "requisicion", "factura_general", "mantenimiento", "ruta",
]);
/** Tipos que NO requieren foto — funcionan solo con audio/transcripción (fotos quedan opcionales). */
const TIPOS_SOLO_VOZ = new Set(["mantenimiento", "checklist_vehiculo"]);

function base64ABlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function normalizar(s: string): string {
  return Array.from(s.normalize("NFD"))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return !(c >= 0x0300 && c <= 0x036f);
    })
    .join("").trim().toLowerCase();
}

/** Empareja contra el catálogo real por coincidencia EXACTA (normalizada). Sin match → descarta, nunca inventa. */
function emparejarExacto(valor: string, catalogo: string[]): string | null {
  const buscado = normalizar(valor);
  if (!buscado) return null;
  const indice = new Map(catalogo.map((c) => [normalizar(c), c]));
  return indice.get(buscado) ?? null;
}

async function leerParametro(svc: Any, clave: string, def: number): Promise<number> {
  const { data } = await svc.schema("sgc").from("parametros").select("valor").eq("clave", clave).maybeSingle();
  const n = data?.valor ? Number(data.valor) : NaN;
  return Number.isFinite(n) ? n : def;
}

const SYSTEM_CONDUCE = `Eres un asistente que ayuda a llenar un CONDUCE EXTERNO (un proveedor mueve material con su propio camión) en una constructora de República Dominicana, a partir de fotos de la placa del camión y/o de la carga.

Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown. Formato EXACTO:
{
  "material": { "valor": string|null, "confianza": number },
  "proveedor_sugerido": { "valor": string|null, "confianza": number },
  "items": [ { "articulo": string, "cantidad": number|null, "unidad": string|null, "confianza": number } ]
}

Reglas estrictas:
- NUNCA inventes un valor que no esté sustentado por la foto. Si no hay evidencia, "valor" es null y "confianza" es 0.
- "material" es una descripción corta y clara de lo que se ve cargado (ej. "20 sacos de cemento", "una nevera").
- "proveedor_sugerido" SOLO si el nombre del proveedor/empresa aparece legible en la foto (rótulo del camión, logo con texto). Si no se ve texto de un nombre, null.
- "articulo" en cada renglón de "items" DEBE ser EXACTAMENTE uno de estos valores del catálogo (copia el texto tal cual); si lo que se ve no calza con ninguno, OMITE ese renglón:
  Catálogo: {{CATALOGO}}
- "confianza" es 0..1: qué tan seguro estás de ese valor exacto.
- Si la foto está oscura, borrosa, o no tiene relación con un camión/carga de construcción, deja todo en null con confianza 0 — no adivines.`;

async function resolverConduceExterno(svc: Any, userClient: Any, fotos: Any[]): Promise<{ propuesta: Any; costoMeta: Any }> {
  const { data: arts } = await svc.schema("sgc").from("articulos").select("nombre").eq("activo", true).limit(500);
  const catalogo: string[] = (arts ?? []).map((a: Any) => String(a.nombre));

  const content: Any[] = [];
  for (const foto of fotos) {
    const data = String(foto?.data ?? "");
    const mime = String(foto?.mime ?? "image/jpeg");
    if (!data) continue;
    content.push({ type: "image", source: { type: "base64", media_type: mime, data } });
  }
  content.push({ type: "text", text: "Devuelve SOLO el JSON con el material, el proveedor sugerido (si se ve) y los renglones del catálogo que reconozcas." });

  const system = SYSTEM_CONDUCE.replace("{{CATALOGO}}", catalogo.length ? catalogo.join(", ") : "(sin catálogo cargado)");

  const anthRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content }] }),
  });
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    throw new Error("El lector no está disponible ahora.");
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;

  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  const itemsCrudos: Any[] = Array.isArray(lectura?.items) ? lectura.items : [];
  const items = itemsCrudos
    .map((it) => ({ ...it, articulo: emparejarExacto(String(it?.articulo ?? ""), catalogo) }))
    .filter((it) => !!it.articulo);

  return {
    propuesta: {
      material: lectura?.material ?? { valor: null, confianza: 0 },
      proveedor_sugerido: lectura?.proveedor_sugerido ?? { valor: null, confianza: 0 },
      items,
    },
    costoMeta: { tokens_in: inTok, tokens_out: outTok, fotos: fotos.length },
  };
}

// F2b (ronda DF) — 'mantenimiento': solo voz (sin foto obligatoria). El vehículo
// se empareja por PLACA o ALIAS exacto del catálogo real; "tipo" es una
// clasificación (preventivo/correctivo) de lo que describió el usuario, no un
// dato inventado — se basa en si menciona una falla/daño (correctivo) o una
// revisión/mantenimiento programado (preventivo).
const SYSTEM_MANTENIMIENTO = `Eres un asistente que ayuda a llenar un reporte de MANTENIMIENTO de vehículo/equipo en una constructora de República Dominicana, a partir de una nota de voz transcrita.

Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown. Formato EXACTO:
{
  "descripcion": { "valor": string|null, "confianza": number },
  "vehiculo_sugerido": { "valor": string|null, "confianza": number },
  "tipo": { "valor": "preventivo"|"correctivo"|null, "confianza": number }
}

Reglas estrictas:
- NUNCA inventes un valor que no esté sustentado por la transcripción. Si no hay evidencia, "valor" es null y "confianza" es 0.
- "descripcion" es un resumen corto y claro del problema o trabajo a realizar (ej. "Fuga de aceite en el motor", "Cambio de aceite y filtros programado").
- "vehiculo_sugerido" DEBE ser EXACTAMENTE uno de estos valores del catálogo (copia el texto tal cual, es placa o alias); si lo que se menciona no calza con ninguno, deja null:
  Catálogo: {{CATALOGO}}
- "tipo": "correctivo" si describe una falla/daño ya ocurrido; "preventivo" si describe una revisión/mantenimiento programado. Si no es claro, null.
- "confianza" es 0..1.
- Si la transcripción está vacía o no tiene relación con un vehículo/equipo, deja todo en null con confianza 0 — no adivines.`;

async function resolverMantenimiento(svc: Any, transcripcion: string): Promise<{ propuesta: Any; costoMeta: Any }> {
  const { data: vehs } = await svc.schema("sgc").from("vehiculos").select("placa, alias").eq("activo", true).limit(500);
  const catalogo: string[] = (vehs ?? []).flatMap((v: Any) => [v.placa, v.alias].filter(Boolean).map(String));

  const system = SYSTEM_MANTENIMIENTO.replace("{{CATALOGO}}", catalogo.length ? catalogo.join(", ") : "(sin catálogo cargado)");
  const content: Any[] = [{ type: "text", text: `<transcripcion_usuario>\n${transcripcion}\n</transcripcion_usuario>\n\nDevuelve SOLO el JSON con la descripción, el vehículo sugerido y el tipo.` }];

  const anthRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 512, system, messages: [{ role: "user", content }] }),
  });
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    throw new Error("El lector no está disponible ahora.");
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;

  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  const vehiculoSugerido = lectura?.vehiculo_sugerido ?? { valor: null, confianza: 0 };
  const matchVehiculo = vehiculoSugerido?.valor ? emparejarExacto(String(vehiculoSugerido.valor), catalogo) : null;

  return {
    propuesta: {
      descripcion: lectura?.descripcion ?? { valor: null, confianza: 0 },
      vehiculo_sugerido: matchVehiculo
        ? { valor: matchVehiculo, confianza: vehiculoSugerido.confianza ?? 0 }
        : { valor: null, confianza: 0 },
      tipo: lectura?.tipo?.valor === "preventivo" || lectura?.tipo?.valor === "correctivo" ? lectura.tipo : { valor: null, confianza: 0 },
    },
    costoMeta: { tokens_in: inTok, tokens_out: outTok, fotos: 0 },
  };
}

// F2b (ronda DF) — 'checklist_vehiculo': voz describiendo el estado del vehículo
// (+ fotos opcionales de daños) → respuesta ok/no por ítem. Los ítems del
// checklist NO son un catálogo fijo de la DB (dependen de la plantilla elegida
// por el usuario, que varía por tipo de vehículo), así que el cliente los manda
// en el payload (`items`) y el modelo elige SOLO entre esos ids — mismo
// principio de "nunca inventa" que el catálogo de artículos/vehículos, aplicado
// a una lista que llega en la petición en vez de una tabla.
const SYSTEM_CHECKLIST = `Eres un asistente que ayuda a llenar un CHECKLIST DE INSPECCIÓN de vehículo/equipo en una constructora de República Dominicana, a partir de una nota de voz transcrita (y opcionalmente fotos de daños) donde el chofer describe el estado del vehículo.

Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown. Formato EXACTO:
{ "respuestas": [ { "id": string, "respuesta": "ok"|"no", "comentario": string|null, "confianza": number } ] }

Reglas estrictas:
- Cada "id" DEBE ser EXACTAMENTE uno de estos ids de la lista de ítems (cópialo tal cual, nunca inventes uno que no esté):
  Ítems (id | etiqueta | crítico): {{ITEMS}}
- Si la transcripción/fotos no mencionan nada sobre un ítem, OMÍTELO del arreglo — no le asignes "ok" por defecto, el usuario lo revisa a mano.
- "respuesta": "no" si describe una falla, daño o problema en ese ítem; "ok" solo si dice explícitamente que ese ítem está bien.
- "comentario": resumen corto de lo que dijo sobre ese ítem, o null si solo confirmó que está bien sin detalle. Si el ítem es CRÍTICO y la respuesta es "no", el comentario es OBLIGATORIO (nunca null) — resume lo que se percibe aunque sea breve.
- "confianza" es 0..1: qué tan seguro estás de esa lectura.
- Si la transcripción está vacía o no tiene relación con un vehículo, devuelve {"respuestas": []} — no adivines.`;

async function resolverChecklistVehiculo(
  items: Any[],
  transcripcion: string,
  fotos: Any[],
): Promise<{ propuesta: Any; costoMeta: Any }> {
  const itemsValidos = items
    .map((it) => ({ id: String(it?.id ?? ""), etiqueta: String(it?.etiqueta ?? ""), es_critico: !!it?.es_critico }))
    .filter((it) => it.id && it.etiqueta);
  const listaItems = itemsValidos.map((it) => `${it.id} | ${it.etiqueta} | ${it.es_critico ? "crítico" : "normal"}`).join("\n");

  const content: Any[] = [];
  for (const foto of fotos) {
    const data = String(foto?.data ?? "");
    const mime = String(foto?.mime ?? "image/jpeg");
    if (!data) continue;
    content.push({ type: "image", source: { type: "base64", media_type: mime, data } });
  }
  content.push({ type: "text", text: `<transcripcion_usuario>\n${transcripcion}\n</transcripcion_usuario>\n\nDevuelve SOLO el JSON con las respuestas de los ítems que se hayan mencionado.` });

  const system = SYSTEM_CHECKLIST.replace("{{ITEMS}}", listaItems || "(sin ítems)");

  const anthRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content }] }),
  });
  if (!anthRes.ok) {
    const t = await anthRes.text();
    console.error("anthropic error", anthRes.status, t.slice(0, 300));
    throw new Error("El lector no está disponible ahora.");
  }
  const anth = await anthRes.json();
  const texto: string = (anth?.content ?? []).map((c: Any) => c?.text ?? "").join("").trim();
  const inTok = anth?.usage?.input_tokens ?? 0;
  const outTok = anth?.usage?.output_tokens ?? 0;

  let lectura: Any = null;
  try {
    const m = texto.match(/\{[\s\S]*\}/);
    lectura = m ? JSON.parse(m[0]) : null;
  } catch { lectura = null; }

  const respuestasCrudas: Any[] = Array.isArray(lectura?.respuestas) ? lectura.respuestas : [];
  // Defensa en profundidad extraída a checklist.ts (testeable sin red/DB).
  const respuestas = validarRespuestasChecklist(respuestasCrudas, itemsValidos);

  return {
    propuesta: { respuestas },
    costoMeta: { tokens_in: inTok, tokens_out: outTok, fotos: fotos.length },
  };
}

Deno.serve(async (req) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: "El lector no está configurado (sin API key)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "No autenticado" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Sesión inválida" }, 401);

  let payload: Any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Cuerpo inválido" }, 400); }
  const tipo = String(payload?.tipo ?? "");
  if (!TIPOS_DECLARADOS.has(tipo)) return json({ ok: false, error: `Tipo de formulario desconocido: "${tipo}".` }, 400);
  if (!TIPOS_IMPLEMENTADOS.has(tipo)) {
    return json({ ok: false, error: `El lector de "${tipo}" todavía no está disponible. Llena el formulario a mano.`, error_code: "tipo_no_implementado" }, 501);
  }

  // ── CI10 — consentimiento de IA explícito. Verificado en servidor. ──
  const { data: consentOk } = await userClient.schema("sgc").rpc("mi_consentimiento", { p_tipo: "ia" });
  if (!consentOk) {
    return json({
      ok: false,
      error: "Para llenar este formulario con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
      error_code: "sin_consentimiento_ia",
    }, 403);
  }

  const fotos: Any[] = Array.isArray(payload?.fotos) ? payload.fotos : [];
  const proyectoId: string | null = payload?.proyecto_id ? String(payload.proyecto_id) : null;
  const audio = payload?.audio ?? null;
  let transcripcion: string = typeof payload?.transcripcion === "string" ? payload.transcripcion : "";
  const items: Any[] = Array.isArray(payload?.items) ? payload.items : [];

  if (TIPOS_SOLO_VOZ.has(tipo)) {
    if (!audio?.data && !transcripcion.trim()) return json({ ok: false, error: "Graba una nota de voz." }, 400);
  } else {
    if (!fotos.length) return json({ ok: false, error: "Agrega al menos una foto." }, 400);
    if (fotos.length > 6) return json({ ok: false, error: "Máximo 6 fotos por lectura." }, 400);
  }
  if (tipo === "checklist_vehiculo" && items.length === 0) {
    return json({ ok: false, error: "Faltan los ítems del checklist." }, 400);
  }
  if (fotos.length > 6) return json({ ok: false, error: "Máximo 6 fotos por lectura." }, 400);

  // ── Transcribir la voz (si llegó audio y no una transcripción ya hecha) ─────
  if (audio?.data && !transcripcion.trim()) {
    const sttCfg = resolverSttConfig();
    if (sttCfg) {
      try {
        const blob = base64ABlob(String(audio.data), String(audio.mime ?? "audio/webm"));
        const ext = String(audio.mime ?? "audio/webm").split("/").pop()?.split(";")[0] || "webm";
        transcripcion = await transcribirAudio(blob, ext, sttCfg);
      } catch (e) {
        console.error("transcribirAudio", e);
      }
    }
  }
  if (TIPOS_SOLO_VOZ.has(tipo) && !transcripcion.trim()) {
    return json({ ok: false, error: "No se pudo transcribir la nota de voz. Llena el formulario a mano." }, 502);
  }

  // ── Rate limit: por usuario/hora y global/día (mismo patrón que bitacora-ia/leer-recibo) ──
  const limHora = await leerParametro(svc, "leer_formulario_limite_usuario_hora", 20);
  const limDia = await leerParametro(svc, "leer_formulario_limite_diario_global", 300);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const [{ count: usoHora }, { count: usoDia }] = await Promise.all([
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", `leer_formulario_${tipo}`).eq("usuario_id", userId).gte("created_at", haceUnaHora),
    svc.schema("sgc").from("uso_ia").select("id", { count: "exact", head: true })
      .eq("funcion", `leer_formulario_${tipo}`).gte("created_at", inicioDia.toISOString()),
  ]);
  if ((usoHora ?? 0) >= limHora) return json({ ok: false, error: "Alcanzaste el límite de usos por hora. Llena el formulario a mano." }, 429);
  if ((usoDia ?? 0) >= limDia) return json({ ok: false, error: "Se alcanzó el límite diario del sistema. Llena el formulario a mano." }, 429);

  let resultado: { propuesta: Any; costoMeta: Any };
  try {
    resultado = tipo === "mantenimiento"
      ? await resolverMantenimiento(svc, transcripcion)
      : tipo === "checklist_vehiculo"
      ? await resolverChecklistVehiculo(items, transcripcion, fotos)
      : await resolverConduceExterno(svc, userClient, fotos);
  } catch (e) {
    console.error(`resolver(${tipo})`, e);
    return json({ ok: false, error: "No se pudo leer el formulario. Llénalo a mano." }, 502);
  }

  const { propuesta, costoMeta } = resultado;
  const confianzas: number[] = tipo === "mantenimiento"
    ? [
        Number(propuesta.descripcion?.confianza ?? 0),
        Number(propuesta.vehiculo_sugerido?.confianza ?? 0),
        Number(propuesta.tipo?.confianza ?? 0),
      ].filter((n: number) => Number.isFinite(n))
    : tipo === "checklist_vehiculo"
    ? propuesta.respuestas.map((r: Any) => Number(r?.confianza ?? 0)).filter((n: number) => Number.isFinite(n))
    : [
        Number(propuesta.material?.confianza ?? 0),
        Number(propuesta.proveedor_sugerido?.confianza ?? 0),
        ...propuesta.items.map((i: Any) => Number(i?.confianza ?? 0)),
      ].filter((n: number) => Number.isFinite(n));
  const confianzaMedia = confianzas.length ? confianzas.reduce((a, b) => a + b, 0) / confianzas.length : 0;

  const costoUsd = Number(costoMeta.tokens_in) * PRECIO_IN + Number(costoMeta.tokens_out) * PRECIO_OUT;
  try {
    await svc.schema("sgc").from("uso_ia").insert({
      usuario_id: userId, funcion: `leer_formulario_${tipo}`, modelo: MODEL,
      tokens_in: costoMeta.tokens_in, tokens_out: costoMeta.tokens_out, costo_estimado: costoUsd,
      meta: { tipo, fotos: costoMeta.fotos },
    });
  } catch (e) { console.error("uso_ia insert", e); }

  let propuestaId: string | null = null;
  try {
    const { data: ins } = await svc.schema("sgc").from("formulario_ia_propuestas").insert({
      tipo, usuario_id: userId, proyecto_id: proyectoId,
      propuesta_json: propuesta, confianza_media: confianzaMedia,
    }).select("id").single();
    propuestaId = ins?.id ?? null;
  } catch (e) { console.error("formulario_ia_propuestas insert", e); }

  return json({ ok: true, propuesta_id: propuestaId, ...propuesta, confianza_media: confianzaMedia, modelo: MODEL });
});
