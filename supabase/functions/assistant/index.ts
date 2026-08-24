import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// AW4 — Asistente de IA "Tato" (v1 solo-lectura).
//
// Patrón (PLAN-ASISTENTE-IA §3): Claude Messages API + tool use detrás de esta
// edge function. Las herramientas ejecutan con el JWT del usuario → RLS aplica
// sola: el asistente HEREDA los permisos de quien le habla. Nunca service role
// para leer datos de negocio.
//
// Secrets:
//   ANTHROPIC_API_KEY  (obligatorio; si falta, responde 503 sin gastar nada)
//   ASSISTANT_MODEL    (opcional; default claude-haiku-4-5-20251001)
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_MSGS_HORA = 60;   // rate limit por usuario
const MAX_TOOL_LOOPS = 6;   // cortes de seguridad del loop de tool use

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Catálogo de herramientas (solo LECTURA) ────────────────────────────────
// modulos=null → disponible para todos; si no, requiere admin o alguno de esos módulos.
interface ToolDef {
  name: string;
  description: string;
  modulos: string[] | null;
  input_schema: Record<string, unknown>;
  rpc: string;
  // deno-lint-ignore no-explicit-any
  map: (i: any) => Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "buscar_articulos",
    description: "Busca artículos del catálogo de inventario por nombre o código (búsqueda tolerante a errores). Úsala cuando pregunten por un material/artículo específico.",
    modulos: null,
    input_schema: { type: "object", properties: { query: { type: "string", description: "Texto a buscar (nombre o código del artículo)" }, limit: { type: "integer", description: "Máximo de resultados (default 15)" } }, required: ["query"] },
    rpc: "buscar_articulos",
    map: (i) => ({ p_query: String(i.query ?? ""), p_limit: Math.min(Number(i.limit ?? 15), 50) }),
  },
  {
    name: "mis_conduces_por_firmar",
    description: "Lista los conduces que el usuario tiene pendientes de FIRMAR como despachante.",
    modulos: null,
    input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_por_firmar",
    map: () => ({}),
  },
  {
    name: "mis_conduces_pendientes_entrega",
    description: "Lista los conduces que el usuario tiene pendientes de ENTREGAR / confirmar.",
    modulos: null,
    input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_pendientes_entrega",
    map: () => ({}),
  },
  {
    name: "mis_tareas",
    description: "Lista las tareas asignadas al usuario. Úsala para '¿qué tareas tengo?'.",
    modulos: null,
    input_schema: { type: "object", properties: { incluir_completadas: { type: "boolean", description: "Incluir también las completadas (default false)" } } },
    rpc: "mis_tareas_app",
    map: (i) => ({ p_incluir_completadas: !!i.incluir_completadas }),
  },
  {
    name: "mis_proyectos",
    description: "Lista los proyectos/obras a los que el usuario tiene acceso.",
    modulos: null,
    input_schema: { type: "object", properties: {} },
    rpc: "mis_proyectos",
    map: () => ({ p_usuario: null }),
  },
  {
    name: "mis_rutas_hoy",
    description: "Lista las rutas de transporte del usuario para hoy (chofer/transportista).",
    modulos: null,
    input_schema: { type: "object", properties: {} },
    rpc: "mis_rutas_hoy",
    map: () => ({}),
  },
  {
    name: "requisiciones_pendientes",
    description: "Bandeja de requisiciones de material/compra. Filtra por estado, obra o urgencia. Requiere permiso de inventario o compras.",
    modulos: ["inventario", "compras"],
    input_schema: { type: "object", properties: { estado: { type: "string", description: "pendiente | aprobada | rechazada | cerrada (opcional)" }, urgencia: { type: "string", description: "alta | media | baja (opcional)" }, busqueda: { type: "string", description: "Texto libre (opcional)" } } },
    rpc: "requisiciones_bandeja",
    map: (i) => ({ p_estado: i.estado ?? "pendiente", p_proyecto_id: null, p_urgencia: i.urgencia ?? null, p_busqueda: i.busqueda ?? null, p_limite: 30 }),
  },
  {
    name: "resumen_proyectos",
    description: "KPIs/resumen de los proyectos (avance, estado). Requiere permiso de proyectos o dirección.",
    modulos: ["proyectos", "direccion"],
    input_schema: { type: "object", properties: {} },
    rpc: "kpi_proyectos",
    map: () => ({}),
  },
  {
    name: "log_combustible",
    description: "Registro reciente de echadas de combustible (quién echó, cuántos galones, rendimiento). Filtra por vehículo y rango de fechas. Requiere permiso de flota.",
    modulos: ["flota"],
    input_schema: { type: "object", properties: { desde: { type: "string", description: "Fecha desde YYYY-MM-DD (opcional)" }, hasta: { type: "string", description: "Fecha hasta YYYY-MM-DD (opcional)" } } },
    rpc: "log_combustible",
    map: (i) => ({ p_desde: i.desde ?? null, p_hasta: i.hasta ?? null, p_vehiculo_id: null, p_usuario_id: null }),
  },
];

function toolsParaUsuario(cap: { es_admin: boolean; modulos: string[] }): ToolDef[] {
  return TOOLS.filter((t) => t.modulos === null || cap.es_admin || t.modulos.some((m) => cap.modulos.includes(m)));
}

function systemPrompt(cap: { nombre: string; es_admin: boolean; modulos: string[] }): string {
  return [
    "Eres Tato, el asistente interno de SGC (el ERP de Constructora SD, una constructora dominicana).",
    "Hablas español dominicano, cercano y de tú, cero corporativo. Eres breve y directo: como un compañero que resuelve.",
    "",
    "REGLAS DURAS:",
    "1. Todo dato/número que des DEBE venir de una herramienta. Si no tienes una herramienta para algo, dilo: \"eso todavía no lo puedo consultar\". NUNCA inventes datos.",
    "2. Solo puedes LEER información. No puedes crear, editar ni borrar nada todavía. Si te lo piden, explícalo con amabilidad.",
    "3. Heredas los permisos de quien te habla. Si una herramienta falla por permisos, di \"no tengo acceso a eso\" sin dar detalles técnicos.",
    "4. Cuando uses una herramienta, resume el resultado en lenguaje claro; no vuelques JSON crudo. Si no hay resultados, dilo.",
    "5. Si falta información para responder (p. ej. cuál obra o vehículo), pregunta antes de asumir.",
    "",
    `Estás hablando con: ${cap.nombre}${cap.es_admin ? " (administrador)" : ""}.`,
    `Módulos a los que tiene acceso: ${cap.modulos.length ? cap.modulos.join(", ") : "ninguno especial"}.`,
    "Cuando diga \"mis\", \"mi obra\", \"mi vehículo\", se refiere a lo suyo — usa las herramientas 'mis_*'.",
  ].join("\n");
}

// deno-lint-ignore no-explicit-any
async function callClaude(system: any, tools: any, messages: any) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, tools, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 300)}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  if (!ANTHROPIC_API_KEY) {
    return json({ error: "El asistente no está configurado todavía (falta la API key). Avísale a Tecnología." }, 503);
  }

  // Cliente con el JWT del usuario → RLS aplica en cada herramienta.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);
  const uid = userData.user.id;

  let payload: { conversacion_id?: string; mensaje?: string };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }
  const mensaje = (payload.mensaje ?? "").toString().trim();
  if (!mensaje) return json({ error: "Mensaje vacío" }, 400);
  if (mensaje.length > 4000) return json({ error: "Mensaje demasiado largo" }, 400);

  // Rate limit por usuario.
  const { data: usados } = await supabase.rpc("assistant_mensajes_ultima_hora");
  if (typeof usados === "number" && usados >= MAX_MSGS_HORA) {
    return json({ error: `Vas muy rápido 😅 (límite ${MAX_MSGS_HORA} mensajes/hora). Espera un momento.` }, 429);
  }

  // Capacidades del usuario (para filtrar tools + contexto del system prompt).
  const { data: cap, error: capErr } = await supabase.rpc("capacidades_asistente");
  if (capErr || !cap) return json({ error: "No pude leer tus permisos." }, 500);
  const modulos: string[] = Array.isArray(cap.modulos) ? cap.modulos : [];
  const capObj = { nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin, modulos };

  // Conversación: crear si no vino una.
  let convId = payload.conversacion_id ?? null;
  if (!convId) {
    const { data: nueva, error: convErr } = await supabase
      .from("assistant_conversaciones")
      .insert({ titulo: mensaje.slice(0, 60) })
      .select("id").single();
    if (convErr) return json({ error: "No pude iniciar la conversación." }, 500);
    convId = nueva!.id as string;
  }

  // Historial previo (para dar contexto al modelo).
  const { data: previos } = await supabase
    .from("assistant_mensajes")
    .select("rol, contenido")
    .eq("conversacion_id", convId)
    .order("created_at", { ascending: true })
    .limit(40);
  // deno-lint-ignore no-explicit-any
  const messages: any[] = (previos ?? [])
    .filter((m) => m.contenido)
    .map((m) => ({ role: m.rol === "assistant" ? "assistant" : "user", content: m.contenido }));
  messages.push({ role: "user", content: mensaje });

  // Herramientas permitidas + prompt caching (system + último tool).
  const disponibles = toolsParaUsuario(capObj);
  const tools = disponibles.map((t, idx) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
    ...(idx === disponibles.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
  const system = [{ type: "text", text: systemPrompt(capObj), cache_control: { type: "ephemeral" } }];

  const herramientasUsadas: { tool: string; ok: boolean }[] = [];
  let respuestaFinal = "";
  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const resp = await callClaude(system, tools, messages);
      // deno-lint-ignore no-explicit-any
      const content: any[] = resp.content ?? [];
      if (resp.stop_reason === "tool_use") {
        // deno-lint-ignore no-explicit-any
        const results: any[] = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          const cfg = disponibles.find((t) => t.name === block.name);
          let out: unknown; let ok = false; let resumen = "";
          if (!cfg) {
            out = { error: "Herramienta no disponible." };
          } else {
            try {
              const { data, error } = await supabase.rpc(cfg.rpc, cfg.map(block.input ?? {}));
              if (error) { out = { error: "No tengo acceso a eso o falló la consulta." }; resumen = error.message.slice(0, 200); }
              else { out = data ?? []; ok = true; resumen = Array.isArray(data) ? `${data.length} fila(s)` : "ok"; }
            } catch (e) {
              out = { error: "Falló la consulta." };
              resumen = (e instanceof Error ? e.message : "error").slice(0, 200);
            }
          }
          herramientasUsadas.push({ tool: block.name, ok });
          // Auditoría (best-effort).
          await supabase.from("assistant_acciones").insert({
            conversacion_id: convId, tool: block.name, params: block.input ?? {}, ok, resumen,
          }).then(() => {}, () => {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 18000) });
        }
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: results });
        continue;
      }
      // Respuesta final de texto.
      respuestaFinal = content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      break;
    }
  } catch (e) {
    return json({ error: `El asistente tuvo un problema: ${e instanceof Error ? e.message : "desconocido"}` }, 502);
  }
  if (!respuestaFinal) respuestaFinal = "No pude completar la consulta. Intenta reformular la pregunta.";

  // Persistir el turno (usuario + asistente) para historial y auditoría.
  await supabase.from("assistant_mensajes").insert([
    { conversacion_id: convId, rol: "user", contenido: mensaje },
    { conversacion_id: convId, rol: "assistant", contenido: respuestaFinal, herramientas: herramientasUsadas },
  ]).then(() => {}, () => {});
  await supabase.from("assistant_conversaciones").update({ updated_at: new Date().toISOString() }).eq("id", convId)
    .then(() => {}, () => {});

  return json({ conversacion_id: convId, respuesta: respuestaFinal, herramientas: herramientasUsadas });
});
