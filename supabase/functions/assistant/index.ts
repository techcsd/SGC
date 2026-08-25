import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// AW4 — Asistente de IA "Compa".
//   v1: consultas (solo lectura).
//   v2: acciones con CONFIRMACIÓN — crear tarea, requisición o conduce. El
//       asistente PREPARA un borrador (herramientas 'proponer_*'); el usuario
//       confirma con un botón; recién ahí la edge function ejecuta la MISMA RPC
//       del flujo normal, con sus mismas validaciones (un solo camino, AU1).
//
// Las herramientas ejecutan con el JWT del usuario → RLS aplica: Compa hereda
// los permisos de quien le habla. Nunca service role para datos de negocio.
//
// Secrets: ANTHROPIC_API_KEY (obligatorio) · ASSISTANT_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_MSGS_HORA = 60;
const MAX_TOOL_LOOPS = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;
interface Cap { usuario_id: string; nombre: string; es_admin: boolean; modulos: string[] }

interface ToolDef {
  name: string;
  description: string;
  modulos: string[] | null;
  input_schema: Record<string, unknown>;
  // Lectura:
  rpc?: string;
  map?: (i: Any) => Record<string, unknown>;
  // Escritura (v2): se PREPARA, no se ejecuta hasta la confirmación.
  write?: {
    tipo: string;
    execRpc: string;
    execMap: (p: Any, cap: Cap) => Record<string, unknown>;
  };
}

const TOOLS: ToolDef[] = [
  // ── LECTURA ──────────────────────────────────────────────────────────────
  {
    name: "buscar_articulos",
    description: "Busca artículos del catálogo por nombre o código (tolerante a errores). Devuelve su id, necesario para preparar requisiciones o conduces.",
    modulos: null,
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] },
    rpc: "buscar_articulos",
    map: (i) => ({ p_query: String(i.query ?? ""), p_limit: Math.min(Number(i.limit ?? 15), 50) }),
  },
  {
    name: "mis_conduces_por_firmar",
    description: "Conduces que el usuario tiene pendientes de FIRMAR como despachante.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_por_firmar", map: () => ({}),
  },
  {
    name: "mis_conduces_pendientes_entrega",
    description: "Conduces que el usuario tiene pendientes de ENTREGAR / confirmar.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_pendientes_entrega", map: () => ({}),
  },
  {
    name: "mis_tareas",
    description: "Tareas asignadas al usuario.",
    modulos: null,
    input_schema: { type: "object", properties: { incluir_completadas: { type: "boolean" } } },
    rpc: "mis_tareas_app", map: (i) => ({ p_incluir_completadas: !!i.incluir_completadas }),
  },
  {
    name: "mis_proyectos",
    description: "Proyectos/obras a los que el usuario tiene acceso. Devuelve su id, necesario para preparar tareas, requisiciones o conduces.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_proyectos", map: () => ({ p_usuario: null }),
  },
  {
    name: "mis_rutas_hoy",
    description: "Rutas de transporte del usuario para hoy.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_rutas_hoy", map: () => ({}),
  },
  {
    name: "buscar_usuarios",
    description: "Busca usuarios por nombre para obtener su id (p. ej. a quién asignar una tarea).",
    modulos: null,
    input_schema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
    rpc: "buscar_usuarios", map: (i) => ({ p_term: String(i.term ?? "") }),
  },
  {
    name: "listar_almacenes",
    description: "Lista los almacenes/bodegas para obtener su id (origen de un conduce). Requiere inventario.",
    modulos: ["inventario"], input_schema: { type: "object", properties: {} },
    rpc: "ubicaciones_almacen", map: () => ({ p_incluir_prueba: false }),
  },
  {
    name: "despachantes_disponibles",
    description: "Despachantes ELEGIBLES para firmar un conduce desde un almacén hacia una obra (regla de elegibilidad AV1).",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" }, proyecto_id: { type: "string" } } },
    rpc: "despachantes_disponibles", map: (i) => ({ p_bodega_id: i.bodega_id ?? null, p_proyecto_id: i.proyecto_id ?? null }),
  },
  {
    name: "requisiciones_pendientes",
    description: "Bandeja de requisiciones. Filtra por estado/urgencia/texto. Requiere inventario o compras.",
    modulos: ["inventario", "compras"],
    input_schema: { type: "object", properties: { estado: { type: "string" }, urgencia: { type: "string" }, busqueda: { type: "string" } } },
    rpc: "requisiciones_bandeja",
    map: (i) => ({ p_estado: i.estado ?? "pendiente", p_proyecto_id: null, p_urgencia: i.urgencia ?? null, p_busqueda: i.busqueda ?? null, p_limite: 30 }),
  },
  {
    name: "resumen_proyectos",
    description: "KPIs/resumen de los proyectos. Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"], input_schema: { type: "object", properties: {} },
    rpc: "kpi_proyectos", map: () => ({}),
  },
  {
    name: "log_combustible",
    description: "Echadas de combustible recientes (galones, rendimiento). Requiere flota.",
    modulos: ["flota"],
    input_schema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
    rpc: "log_combustible", map: (i) => ({ p_desde: i.desde ?? null, p_hasta: i.hasta ?? null, p_vehiculo_id: null, p_usuario_id: null }),
  },

  // ── ESCRITURA (v2: preparar → confirmar → ejecutar) ────────────────────────
  {
    name: "proponer_tarea",
    description: "PREPARA una tarea para asignar (borrador; NO la crea hasta que el usuario confirme). Obtén el proyecto_id con 'mis_proyectos' y, si aplica, el asignado con 'buscar_usuarios'. Requiere módulo tareas.",
    modulos: ["tareas"],
    input_schema: {
      type: "object",
      properties: {
        proyecto_id: { type: "string" }, titulo: { type: "string" }, descripcion: { type: "string" },
        asignado_a: { type: "string", description: "usuario_id de a quién se asigna (opcional)" },
        prioridad: { type: "string", description: "alta | media | baja" },
        fecha_limite: { type: "string", description: "YYYY-MM-DD (opcional)" },
      }, required: ["proyecto_id", "titulo"],
    },
    write: {
      tipo: "tarea", execRpc: "asignar_tarea_obra",
      execMap: (p) => ({ p_id: null, p_proyecto_id: p.proyecto_id, p_titulo: p.titulo, p_descripcion: p.descripcion ?? null, p_asignado_a: p.asignado_a ?? null, p_brigada: null, p_prioridad: p.prioridad ?? "media", p_fecha_limite: p.fecha_limite ?? null }),
    },
  },
  {
    name: "proponer_requisicion",
    description: "PREPARA una requisición de material (borrador). Obtén el proyecto_id con 'mis_proyectos' y el articulo_id de cada ítem con 'buscar_articulos'. Pregunta los ítems y cantidades si faltan. Requiere inventario o compras.",
    modulos: ["inventario", "compras"],
    input_schema: {
      type: "object",
      properties: {
        proyecto_id: { type: "string" }, urgencia: { type: "string", description: "alta | media | baja" }, notas: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { articulo_id: { type: "string" }, cantidad: { type: "number" }, unidad: { type: "string" } }, required: ["articulo_id", "cantidad"] } },
      }, required: ["proyecto_id", "items"],
    },
    write: {
      tipo: "requisicion", execRpc: "crear_solicitud_material",
      execMap: (p, cap) => ({ p_proyecto_id: p.proyecto_id, p_solicitante_id: cap.usuario_id, p_urgencia: p.urgencia ?? "media", p_notas: p.notas ?? null, p_items: (p.items ?? []).map((it: Any) => ({ articulo_id: it.articulo_id, descripcion: null, cantidad: it.cantidad, unidad: it.unidad ?? null, talla: null })) }),
    },
  },
  {
    name: "proponer_conduce",
    description: "PREPARA un conduce/salida de material (borrador). Necesitas el almacén de origen ('listar_almacenes'), la obra de destino ('mis_proyectos') y los ítems con su articulo_id ('buscar_articulos'). Opcional: vehículo y despachante ('despachantes_disponibles'). Pregunta los ítems si el usuario no los dio. Requiere módulo inventario.",
    modulos: ["inventario"],
    input_schema: {
      type: "object",
      properties: {
        bodega_id: { type: "string", description: "almacén de origen" },
        proyecto_id: { type: "string", description: "obra de destino" },
        vehiculo_id: { type: "string" }, observaciones: { type: "string" },
        despachante_usuario_id: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { articulo_id: { type: "string" }, cantidad: { type: "number" } }, required: ["articulo_id", "cantidad"] } },
      }, required: ["bodega_id", "proyecto_id", "items"],
    },
    write: {
      tipo: "conduce", execRpc: "crear_conduce_simple",
      execMap: (p) => ({ p_id: crypto.randomUUID(), p_fecha: new Date().toISOString().slice(0, 10), p_bodega_id: p.bodega_id, p_proyecto_id: p.proyecto_id, p_observaciones: p.observaciones ?? null, p_vehiculo_id: p.vehiculo_id ?? null, p_ruta_id: null, p_items: (p.items ?? []).map((it: Any) => ({ articulo_id: it.articulo_id, cantidad: it.cantidad })), p_despachante_nombre: null, p_despachante_usuario_id: p.despachante_usuario_id ?? null, p_despachante_empleado_id: null, p_carga_foto_path: null, p_firma_chofer_path: null, p_firma_despachante_path: null }),
    },
  },
];

function toolsParaUsuario(cap: Cap): ToolDef[] {
  return TOOLS.filter((t) => t.modulos === null || cap.es_admin || t.modulos.some((m) => cap.modulos.includes(m)));
}

function systemPrompt(cap: Cap): string {
  return [
    "Eres Compa, el asistente interno de SGC (el ERP de Constructora SD, una constructora dominicana).",
    "Hablas español dominicano, cercano y de tú, cero corporativo. Breve y directo, como un compañero que resuelve.",
    "",
    "QUÉ PUEDES HACER:",
    "- CONSULTAR información (herramientas de lectura). Todo dato/número que des DEBE salir de una herramienta; si no tienes una, dilo (\"eso todavía no lo puedo consultar\"). NUNCA inventes datos ni IDs.",
    "- PREPARAR acciones con las herramientas 'proponer_*' (crear tarea, requisición, conduce). NUNCA ejecutas directo: al llamar una 'proponer_*' el sistema le muestra al usuario una tarjeta para CONFIRMAR. Tú solo dile en una frase corta qué preparaste y pídele que confirme.",
    "",
    "REGLAS DURAS:",
    "1. Para preparar una acción primero RESUELVE los IDs con las herramientas de lectura (mis_proyectos para la obra, buscar_articulos para cada ítem, listar_almacenes para el almacén, despachantes_disponibles, buscar_usuarios). Jamás inventes un ID.",
    "2. Si te falta un dato para la acción (obra, ítems, cantidades), PREGUNTA antes de preparar. No asumas.",
    "3. Heredas los permisos del usuario. Si una herramienta falla por permisos, di \"no tengo acceso a eso\" sin tecnicismos.",
    "4. Resume los resultados en lenguaje claro; no vuelques JSON. Si no hay resultados, dilo.",
    "5. Nunca digas que una acción \"ya está hecha\" solo por prepararla: queda pendiente hasta que el usuario confirme en la tarjeta.",
    "",
    `Estás hablando con: ${cap.nombre}${cap.es_admin ? " (administrador)" : ""}.`,
    `Módulos con acceso: ${cap.modulos.length ? cap.modulos.join(", ") : "ninguno especial"}.`,
    "Cuando diga \"mis\", \"mi obra\", \"mi vehículo\", usa las herramientas 'mis_*'.",
  ].join("\n");
}

async function callClaude(system: Any, tools: Any, messages: Any) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1400, system, tools, messages }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

// Construye un resumen legible de la propuesta (para la tarjeta de confirmación),
// resolviendo nombres con el JWT del usuario (RLS aplica).
async function construirPropuesta(supabase: Any, cfg: ToolDef, input: Any) {
  const tipo = cfg.write!.tipo;
  const lineas: string[] = [];
  let titulo = "Confirmar acción";

  const nombreObra = async (id: string) => {
    const { data } = await supabase.from("proyectos").select("nombre, codigo").eq("id", id).maybeSingle();
    return data ? (data.codigo ? `${data.codigo} · ${data.nombre}` : data.nombre) : "obra";
  };
  const nombresArticulos = async (ids: string[]) => {
    const { data } = await supabase.from("articulos").select("id, nombre").in("id", ids);
    const map = new Map((data ?? []).map((a: Any) => [a.id, a.nombre]));
    return map;
  };

  if (tipo === "tarea") {
    titulo = "Crear tarea";
    lineas.push(`Título: ${input.titulo}`);
    lineas.push(`Obra: ${await nombreObra(input.proyecto_id)}`);
    if (input.asignado_a) {
      const { data } = await supabase.from("usuarios").select("nombre").eq("id", input.asignado_a).maybeSingle();
      lineas.push(`Asignada a: ${data?.nombre ?? input.asignado_a}`);
    }
    lineas.push(`Prioridad: ${input.prioridad ?? "media"}`);
    if (input.fecha_limite) lineas.push(`Fecha límite: ${input.fecha_limite}`);
    if (input.descripcion) lineas.push(`Descripción: ${input.descripcion}`);
  } else if (tipo === "requisicion" || tipo === "conduce") {
    const items: Any[] = input.items ?? [];
    const map = await nombresArticulos(items.map((i) => i.articulo_id));
    if (tipo === "conduce") {
      titulo = "Crear conduce (salida de material)";
      const { data: b } = await supabase.from("bodegas").select("nombre").eq("id", input.bodega_id).maybeSingle();
      lineas.push(`Origen (almacén): ${b?.nombre ?? input.bodega_id}`);
      lineas.push(`Destino (obra): ${await nombreObra(input.proyecto_id)}`);
      if (input.vehiculo_id) {
        const { data: v } = await supabase.from("vehiculos").select("placa, marca").eq("id", input.vehiculo_id).maybeSingle();
        if (v) lineas.push(`Vehículo: ${v.placa ?? ""} ${v.marca ?? ""}`.trim());
      }
      if (input.despachante_usuario_id) {
        const { data: d } = await supabase.from("usuarios").select("nombre").eq("id", input.despachante_usuario_id).maybeSingle();
        lineas.push(`Despachante: ${d?.nombre ?? input.despachante_usuario_id}`);
      }
    } else {
      titulo = "Crear requisición de material";
      lineas.push(`Obra: ${await nombreObra(input.proyecto_id)}`);
      lineas.push(`Urgencia: ${input.urgencia ?? "media"}`);
    }
    lineas.push(`Artículos (${items.length}):`);
    for (const it of items) lineas.push(`  • ${map.get(it.articulo_id) ?? it.articulo_id} × ${it.cantidad}${it.unidad ? " " + it.unidad : ""}`);
    if (input.observaciones) lineas.push(`Obs.: ${input.observaciones}`);
    if (input.notas) lineas.push(`Notas: ${input.notas}`);
  }
  return { tipo, tool: cfg.name, params: input, titulo, lineas };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  if (!ANTHROPIC_API_KEY) return json({ error: "El asistente no está configurado todavía (falta la API key). Avísale a Tecnología." }, 503);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  let payload: { conversacion_id?: string; mensaje?: string; ejecutar?: Any };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }

  // Capacidades del usuario.
  const { data: cap, error: capErr } = await supabase.rpc("capacidades_asistente");
  if (capErr || !cap) return json({ error: "No pude leer tus permisos." }, 500);
  const modulos: string[] = Array.isArray(cap.modulos) ? cap.modulos : [];
  const capObj: Cap = { usuario_id: cap.usuario_id, nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin, modulos };

  // ── Branch CONFIRMAR: ejecuta la acción preparada (mismo RPC del flujo normal) ──
  if (payload.ejecutar) {
    const prop = payload.ejecutar;
    const convId = payload.conversacion_id ?? null;
    const cfg = TOOLS.find((t) => t.name === prop.tool && t.write);
    if (!cfg) return json({ error: "Acción no reconocida." }, 400);
    if (!(cfg.modulos === null || capObj.es_admin || cfg.modulos!.some((m) => modulos.includes(m)))) {
      return json({ error: "No tienes permiso para esa acción." }, 403);
    }
    let respuesta = "";
    let ok = false;
    try {
      const { error } = await supabase.rpc(cfg.write!.execRpc, cfg.write!.execMap(prop.params, capObj));
      if (error) {
        respuesta = `No se pudo completar: ${error.message}`;
      } else {
        ok = true;
        respuesta = cfg.write!.tipo === "conduce" ? "✅ Conduce creado. Queda pendiente de firma por el flujo normal."
          : cfg.write!.tipo === "requisicion" ? "✅ Requisición creada y enviada a aprobación."
          : "✅ Tarea creada y asignada.";
      }
    } catch (e) {
      respuesta = `No se pudo completar: ${e instanceof Error ? e.message : "error"}`;
    }
    if (convId) {
      await supabase.from("assistant_acciones").insert({ conversacion_id: convId, tool: prop.tool, params: prop.params, ok, resumen: respuesta.slice(0, 200) }).then(() => {}, () => {});
      await supabase.from("assistant_mensajes").insert({ conversacion_id: convId, rol: "assistant", contenido: respuesta }).then(() => {}, () => {});
    }
    return json({ conversacion_id: convId, respuesta, ejecutado: ok });
  }

  // ── Branch CHAT ────────────────────────────────────────────────────────────
  const mensaje = (payload.mensaje ?? "").toString().trim();
  if (!mensaje) return json({ error: "Mensaje vacío" }, 400);
  if (mensaje.length > 4000) return json({ error: "Mensaje demasiado largo" }, 400);

  const { data: usados } = await supabase.rpc("assistant_mensajes_ultima_hora");
  if (typeof usados === "number" && usados >= MAX_MSGS_HORA) {
    return json({ error: `Vas muy rápido 😅 (límite ${MAX_MSGS_HORA} mensajes/hora). Espera un momento.` }, 429);
  }

  let convId = payload.conversacion_id ?? null;
  if (!convId) {
    const { data: nueva, error: convErr } = await supabase.from("assistant_conversaciones").insert({ titulo: mensaje.slice(0, 60) }).select("id").single();
    if (convErr) return json({ error: "No pude iniciar la conversación." }, 500);
    convId = nueva!.id as string;
  }

  const { data: previos } = await supabase.from("assistant_mensajes").select("rol, contenido").eq("conversacion_id", convId).order("created_at", { ascending: true }).limit(40);
  const messages: Any[] = (previos ?? []).filter((m: Any) => m.contenido).map((m: Any) => ({ role: m.rol === "assistant" ? "assistant" : "user", content: m.contenido }));
  messages.push({ role: "user", content: mensaje });

  const disponibles = toolsParaUsuario(capObj);
  const tools = disponibles.map((t, idx) => ({ name: t.name, description: t.description, input_schema: t.input_schema, ...(idx === disponibles.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
  const system = [{ type: "text", text: systemPrompt(capObj), cache_control: { type: "ephemeral" } }];

  const herramientasUsadas: { tool: string; ok: boolean }[] = [];
  let propuesta: Any = null;
  let respuestaFinal = "";
  try {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const resp = await callClaude(system, tools, messages);
      const content: Any[] = resp.content ?? [];
      if (resp.stop_reason === "tool_use") {
        const results: Any[] = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          const cfg = disponibles.find((t) => t.name === block.name);
          let out: unknown; let ok = false; let resumen = "";
          if (!cfg) {
            out = { error: "Herramienta no disponible." };
          } else if (cfg.write) {
            // Acción de ESCRITURA: se PREPARA, no se ejecuta. Devuelve borrador.
            try {
              propuesta = await construirPropuesta(supabase, cfg, block.input ?? {});
              out = { preparado: true, resumen: propuesta.lineas.join("\n"), instruccion: "Dile al usuario en una frase qué preparaste y que confirme en la tarjeta. No digas que ya está hecho." };
              ok = true; resumen = `propuesta ${cfg.write.tipo}`;
            } catch (e) {
              out = { error: "No pude preparar la acción." };
              resumen = (e instanceof Error ? e.message : "error").slice(0, 200);
            }
          } else {
            // Lectura.
            try {
              const { data, error } = await supabase.rpc(cfg.rpc!, cfg.map!(block.input ?? {}));
              if (error) { out = { error: "No tengo acceso a eso o falló la consulta." }; resumen = error.message.slice(0, 200); }
              else { out = data ?? []; ok = true; resumen = Array.isArray(data) ? `${data.length} fila(s)` : "ok"; }
            } catch (e) { out = { error: "Falló la consulta." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
          }
          herramientasUsadas.push({ tool: block.name, ok });
          await supabase.from("assistant_acciones").insert({ conversacion_id: convId, tool: block.name, params: block.input ?? {}, ok, resumen }).then(() => {}, () => {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 18000) });
        }
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: results });
        continue;
      }
      respuestaFinal = content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      break;
    }
  } catch (e) {
    return json({ error: `El asistente tuvo un problema: ${e instanceof Error ? e.message : "desconocido"}` }, 502);
  }
  if (!respuestaFinal) respuestaFinal = propuesta ? "Preparé la acción; revísala y confírmala abajo." : "No pude completar la consulta. Intenta reformular.";

  await supabase.from("assistant_mensajes").insert([
    { conversacion_id: convId, rol: "user", contenido: mensaje },
    { conversacion_id: convId, rol: "assistant", contenido: respuestaFinal, herramientas: herramientasUsadas },
  ]).then(() => {}, () => {});
  await supabase.from("assistant_conversaciones").update({ updated_at: new Date().toISOString() }).eq("id", convId).then(() => {}, () => {});

  return json({ conversacion_id: convId, respuesta: respuestaFinal, herramientas: herramientasUsadas, propuesta });
});
