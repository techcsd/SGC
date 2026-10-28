// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// CR1 (FASE 3-4) — Servidor MCP remoto del SGC: el real, no el mínimo de FASE 0.
//   Streamable HTTP sin estado. verify_jwt=false (ver supabase/config.toml, el
//   porqué). withSupabase({auth:'user'}) valida el token contra el JWKS del
//   proyecto y da un cliente YA scoped a esa persona — RLS idéntica a Compa.
//
//   Registro de herramientas: COMPARTIDO con Compa (_shared/herramientas.ts).
//   `tools/list` filtra por módulo/admin y por canal 'mcp' (toolsParaUsuario).
//   `tools/call` REVALIDA siempre (nunca confía en lo que list ofreció), y:
//     - lectura (rpc+map)  → ejecuta con el cliente del usuario, tal cual Compa.
//     - escritura (write)  → NUNCA ejecuta: crea un borrador (claude_borrador_crear,
//       FASE 2) y devuelve el enlace a /borrador/:id para que la persona confirme
//       (FASE 4). "Nada se crea desde Claude" (CONTEXTO-51 §B3).
//     - gap (reportar_gap) → registra la falta (registrar_consulta_no_atendida).
//     - pdf/memoria         → NO se ofrecen en MCP (canales:['compa'] los excluye
//       del registro que ve toolsParaUsuario(cap,'mcp') — nunca llegan aquí).
//   Cada llamada queda en sgc.claude_llamadas (éxito o error), nunca el resultado
//   completo. Antes de construir nada: interruptor general, consentimiento de IA
//   (mismo gate que Compa) y límite por hora.
// ============================================================================
import { createMcpHandler, Server } from "npm:@modelcontextprotocol/server@^2.0.0";
import { pipeline } from "npm:@supabase/middleware@1";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1";
import {
  toolsParaUsuario, ejecutarHerramientaLectura, claveIdem,
  type Cap, type ToolDef, type Any,
} from "../_shared/herramientas.ts";

const MAX_CHARS = 25_000; // B1 — tope de resultado, con aviso "hay más"
const MAX_MS = 15_000;    // B1 — tiempo máximo por llamada
const WEB_URL = Deno.env.get("WEB_URL") ?? "";

const INSTRUCCIONES_MCP = [
  "Eres un conector del SGC (el ERP de Constructora SD, una constructora dominicana) para Claude Desktop.",
  "Cada herramienta ejecuta con los permisos REALES de la persona conectada — ves exactamente lo que ella ve en el SGC, ni más ni menos. Si una herramienta dice que no tiene acceso, es real, no insistas.",
  "Todo dato que uses DEBE salir de una herramienta; nunca inventes IDs, nombres, cifras ni estados.",
  "Las herramientas 'proponer_*' NUNCA crean nada en el SGC: preparan un borrador y te devuelven 'url' — dile a la persona que lo revise y confirme ahí. NUNCA digas que ya quedó creado/enviado/aprobado.",
  "Si no sabes qué herramienta usar, o el usuario pregunta por un área del SGC que no reconoces, llama 'que_puedo_consultar' PRIMERO: te dice, módulo por módulo, si esta persona tiene acceso y qué herramienta usar.",
  "Si te piden algo para lo que no tienes ninguna herramienta (ni siquiera via 'que_puedo_consultar'), usa 'reportar_gap' y dilo con honestidad — no finjas que lo resolviste.",
  "Si un resultado trae '[truncado: ...]' al final, hay más datos de los que caben en la respuesta — sugiere filtrar o acotar la búsqueda, no asumas que eso es todo.",
].join("\n");

// B1 — 3 prompts (atajos de Claude Desktop).
const PROMPTS = [
  {
    name: "resumen_de_mi_dia", description: "Un resumen de lo que tienes pendiente hoy en el SGC.",
    texto: "Dame un resumen de mi día en el SGC: mis tareas, mis rutas de hoy si tengo, y cualquier cosa pendiente de mi parte.",
  },
  {
    name: "que_me_falta_aprobar", description: "Qué está esperando tu aprobación o atención.",
    texto: "¿Qué tengo pendiente de aprobar o atender en el SGC ahora mismo?",
  },
  {
    name: "preparar_una_requisicion", description: "Prepara el borrador de una requisición de material.",
    texto: "Ayúdame a preparar una requisición de material para una obra. Pregúntame lo que haga falta y prepárala como borrador.",
  },
];

function recortar(texto: string): { texto: string; truncado: boolean } {
  if (texto.length <= MAX_CHARS) return { texto, truncado: false };
  return { texto: texto.slice(0, MAX_CHARS), truncado: true };
}

async function registrarLlamada(
  sgc: Any, herramienta: string, ok: boolean, error: string | null,
  duracionMs: number, filas: number | null, params: Any,
) {
  await sgc.rpc("claude_llamada_registrar", {
    p_herramienta: herramienta,
    p_ok: ok,
    p_error: error,
    p_duracion_ms: duracionMs,
    p_filas: filas,
    p_params_resumen: params ? { resumen: JSON.stringify(params).slice(0, 300) } : null,
  }).then(() => {}, () => {});
}

// Resumen corto y legible del borrador (el detalle fino con nombres resueltos
// vive en /borrador/:id, FASE 4 — aquí solo es la etiqueta de la llamada).
function resumenBorrador(cfg: ToolDef, input: Any): string {
  if (cfg.write!.tipo === "tarea") return `Tarea: ${String(input.titulo ?? "").slice(0, 80)}`;
  if (cfg.write!.tipo === "requisicion") return `Requisición: ${(input.items ?? []).length} artículo(s)`;
  if (cfg.write!.tipo === "conduce") return `Conduce: ${(input.items ?? []).length} artículo(s)`;
  if (cfg.write!.tipo === "ruta") return "Ruta de transporte";
  if (cfg.write!.tipo === "cambio_tarea") return "Cambio de tarea";
  if (cfg.write!.tipo === "reunion") return `Reunión: ${String(input.titulo ?? "").slice(0, 80)}`;
  if (cfg.write!.tipo === "cancelar_reunion") return "Cancelar reunión";
  if (cfg.write!.tipo === "cerrar_acuerdo") return "Cerrar acuerdo de reunión";
  if (cfg.write!.tipo === "decision_requisicion") return `Requisición: ${input.decision === "rechazar" ? "rechazar" : "aprobar"}`;
  if (cfg.write!.tipo === "orden_compra") return `Orden de compra: ${(input.items ?? []).length} artículo(s)`;
  if (cfg.write!.tipo === "entrada_inventario") return `Entrada de inventario: ${(input.items ?? []).length} artículo(s)`;
  if (cfg.write!.tipo === "solicitud_movimiento") return "Solicitud de movimiento";
  if (cfg.write!.tipo === "correccion_conduce") return "Corrección de conduce";
  if (cfg.write!.tipo === "mantenimiento") return "Mantenimiento de vehículo";
  if (cfg.write!.tipo === "bitacora") return "Entrada de bitácora";
  if (cfg.write!.tipo === "decision_legal") return `Aprobación legal: ${input.estado ?? ""}`;
  if (cfg.write!.tipo === "actualizacion_expediente") return "Actualización de expediente legal";
  if (cfg.write!.tipo === "mensaje") return "Mensaje directo";
  if (cfg.write!.tipo === "cambio_envio_automatico") return `Envío automático: ${input.activo ? "encender" : "apagar"} ${input.familia ?? ""}`;
  if (cfg.write!.tipo === "probar_envio") return `Probar envío: ${input.familia ?? ""}`;
  if (cfg.write!.tipo === "nota_de_version") return `Nota de versión ${input.version ?? ""}`;
  if (cfg.write!.tipo === "tipo_equipo") return `Tipo de equipo: ${String(input.label ?? "").slice(0, 60)}`;
  if (cfg.write!.tipo === "equipo_tecnologico") return input.id ? `Editar equipo: ${String(input.nombre ?? input.id).slice(0, 60)}` : `Equipo nuevo: ${String(input.nombre ?? "").slice(0, 60)}`;
  if (cfg.write!.tipo === "cambio_estado_equipo") return "Cambio de situación/condición de equipo";
  if (cfg.write!.tipo === "asignacion_equipo") return "Reasignación de equipo";
  if (cfg.write!.tipo === "equipos_lote") return `Lote de equipos tecnológicos: ${(input.equipos ?? []).length} equipo(s)`;
  return cfg.write!.tipo;
}

async function ejecutarTool(sgc: Any, cfg: ToolDef, input: Any, cap: Cap): Promise<{ ok: boolean; out: Any }> {
  if (cfg.escrituraDirecta) {
    // CX2 — tercer modo, además de lectura y borrador: ejecuta YA MISMO (nunca un
    // borrador), con el cliente del usuario — RLS/chequeos del RPC deciden, nunca
    // una llave de servicio. Reservado a lo que la nota de Xaviel marcó bajo
    // riesgo (notas propias, estado de un reporte de soporte).
    const { data, error } = await sgc.rpc(cfg.escrituraDirecta.rpc, cfg.escrituraDirecta.map(input, cap));
    if (error) {
      const esPermiso = /42501|permission|no autorizado|autorizad/i.test(error.message || "");
      return { ok: false, out: esPermiso ? "No tienes acceso a eso con tu rol." : `No se pudo completar: ${error.message}` };
    }
    return { ok: true, out: data ?? { hecho: true } };
  }
  if (cfg.gap) {
    const tema = String(input?.tema ?? "");
    const { error } = await sgc.rpc("registrar_consulta_no_atendida", {
      p_pregunta: tema, p_motivo: "sin_tool", p_tool: null, p_detalle: tema.slice(0, 400), p_conversacion_id: null,
    });
    if (error) return { ok: false, out: "No pude registrar la falta." };
    return { ok: true, out: { registrado: true, mensaje: "Anotado para Tecnología." } };
  }
  if (cfg.write) {
    // CR1 §B3 — "nada se crea desde Claude": solo un borrador, idempotente por
    // la MISMA claveIdem que usa Compa (un pedido repetido = el mismo borrador).
    const idem = claveIdem(cap.usuario_id, cfg.write.tipo, input);
    const { data, error } = await sgc.rpc("claude_borrador_crear", {
      p_tool: cfg.name, p_params: input, p_resumen: resumenBorrador(cfg, input), p_idem: idem,
    });
    if (error) return { ok: false, out: `No se pudo preparar la acción: ${error.message}` };
    const url = `${WEB_URL}/borrador/${data.id}`;
    return {
      ok: true,
      out: {
        borrador_id: data.id, url,
        mensaje: "Borrador preparado — todavía NO existe en el SGC; la persona debe confirmarlo en el enlace.",
      },
    };
  }
  // Lectura — mismo camino que Compa (RPC + map del registro compartido).
  const { data, error } = await ejecutarHerramientaLectura(sgc, cfg, input);
  if (error) {
    const msg = error.message || "";
    const esPermiso = /42501|permission|no autorizado|autorizad/i.test(msg);
    // CX1 — "Could not find the function ... in the schema cache" (PostgREST)
    // casi siempre significa que a la llamada le faltó un parámetro obligatorio
    // o vino con un nombre que no es el del esquema (ej. Raykler pidiendo
    // 'almacen'/'almacen_id' cuando la tool pide 'bodega_id'). El mensaje crudo
    // de Postgres no le sirve a nadie (BS2) — se traduce a algo que Claude
    // pueda de verdad corregir en el siguiente intento.
    const esFirmaNoEncontrada = /could not find the function|pgrst202/i.test(msg);
    const out = esPermiso
      ? "No tienes acceso a eso con tu rol."
      : esFirmaNoEncontrada
        ? "Faltó un dato obligatorio o el nombre de un parámetro no es el que espera esta herramienta — revisa el esquema de entrada (input_schema) y vuelve a intentar con los nombres exactos."
        : `La consulta falló: ${msg}`;
    return { ok: false, out };
  }
  // CR1 §5 (defensa en profundidad) — PERMISOS-TOOLS.md ya anota que
  // buscar_usuarios expone email; Compa lo tolera (uso interno), MCP sale
  // hacia un tercero (Anthropic) y lo recorta.
  if (cfg.name === "buscar_usuarios" && Array.isArray(data)) {
    return { ok: true, out: data.map((u: Any) => ({ id: u.id, nombre: u.nombre })) };
  }
  return { ok: true, out: data ?? [] };
}

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    async (req: Request, { supabase }: Any) => {
      const sgc = supabase.schema("sgc");
      const jsonError = (status: number, message: string) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message } }), {
          status, headers: { "content-type": "application/json" },
        });

      // ── Interruptor general (B1) — se revisa en CADA petición ───────────────
      const { data: cfg, error: cfgErr } = await sgc.rpc("claude_conector_config");
      if (cfgErr) return jsonError(500, "No se pudo leer la configuración del conector.");
      if (!cfg?.activo) return jsonError(503, "El conector de Claude está apagado por ahora. Avísale a Tecnología si lo necesitas.");

      // ── Identidad + capacidades (igual que Compa) ────────────────────────────
      const { data: cap, error: capErr } = await sgc.rpc("capacidades_asistente");
      if (capErr || !cap) return jsonError(500, "No pude leer tus permisos del SGC.");
      const capObj: Cap = {
        usuario_id: cap.usuario_id, nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin,
        modulos: Array.isArray(cap.modulos) ? cap.modulos : [], roles: Array.isArray(cap.roles) ? cap.roles : [],
        // DA-16 — permisos granulares (AG12), para que tools con `submodulos`
        // se ofrezcan sin el módulo completo (ej. Subadministrador).
        permisos: cap.permisos && typeof cap.permisos === "object" ? cap.permisos : {},
      };

      // ── Consentimiento de IA — mismo gate que Compa (CI10) ───────────────────
      const { data: consentOk } = await sgc.rpc("mi_consentimiento", { p_tipo: "ia" });
      if (!consentOk) return jsonError(403, "Activa el consentimiento de IA en Perfil › Privacidad del SGC para usar el conector de Claude.");

      // ── Límite por hora (claude_conector_max_hora) ───────────────────────────
      const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString();
      const { count } = await sgc.from("claude_llamadas").select("id", { count: "exact", head: true })
        .eq("usuario_id", capObj.usuario_id).gte("creado_en", haceUnaHora);
      const maxHora = Number(cfg.max_hora ?? 120);
      if ((count ?? 0) >= maxHora) return jsonError(429, `Vas muy rápido con el conector (límite ${maxHora}/hora). Espera un momento.`);

      const disponibles = toolsParaUsuario(capObj, "mcp");

      const handler = createMcpHandler(() => {
        const server = new Server(
          { name: "sgc", version: "1.0.0" },
          { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCCIONES_MCP },
        );

        server.setRequestHandler("tools/list", async () => ({
          tools: disponibles.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.input_schema,
            annotations: t.write || t.escrituraDirecta
              ? { readOnlyHint: false, destructiveHint: false, idempotentHint: !!t.write }
              : { readOnlyHint: true, idempotentHint: true },
          })),
        }));

        server.setRequestHandler("prompts/list", async () => ({
          prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description, arguments: [] })),
        }));
        server.setRequestHandler("prompts/get", async (request: Any) => {
          const p = PROMPTS.find((x) => x.name === request.params?.name);
          if (!p) throw new Error("Prompt no encontrado.");
          return { messages: [{ role: "user", content: { type: "text", text: p.texto } }] };
        });

        server.setRequestHandler("tools/call", async (request: Any) => {
          const nombre = String(request.params?.name ?? "");
          const args = request.params?.arguments ?? {};
          const inicio = Date.now();
          // Revalida SIEMPRE módulo/canal — tools/list ya filtró, pero una
          // llamada directa no se confía ciegamente (B1 "cada llamada vuelve a
          // validar módulo y gates del RPC").
          const cfgTool = disponibles.find((t) => t.name === nombre);
          if (!cfgTool) {
            await registrarLlamada(sgc, nombre, false, "herramienta no disponible para tu rol", Date.now() - inicio, null, args);
            return { content: [{ type: "text", text: "Esa herramienta no está disponible con tu acceso actual." }], isError: true };
          }

          try {
            const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tiempo máximo excedido")), MAX_MS));
            const resultado = await Promise.race([ejecutarTool(sgc, cfgTool, args, capObj), timeout]);
            const { texto, truncado } = recortar(JSON.stringify(resultado.out));
            await registrarLlamada(
              sgc, nombre, resultado.ok, resultado.ok ? null : texto.slice(0, 300),
              Date.now() - inicio, Array.isArray(resultado.out) ? resultado.out.length : null, args,
            );
            return {
              content: [{ type: "text", text: truncado ? `${texto}\n\n[truncado: hay más datos de los que caben aquí — pide filtrar o acotar]` : texto }],
              isError: !resultado.ok,
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "error";
            await registrarLlamada(sgc, nombre, false, msg, Date.now() - inicio, null, args);
            return { content: [{ type: "text", text: `No se pudo completar: ${msg}` }], isError: true };
          }
        });

        return server;
      });

      return handler.fetch(req);
    },
  ),
);
