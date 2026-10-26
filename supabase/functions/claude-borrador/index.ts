import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { TOOLS, type Cap, type Any } from "../_shared/herramientas.ts";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";

// ============================================================================
// CR1 (FASE 4) — confirma/descarta un borrador que Claude Desktop preparó por
// MCP (sgc.claude_borradores, creado en mcp/index.ts). "Un solo camino de
// ejecución" (AU1): `confirmar` corre el MISMO execRpc/execMap del registro
// compartido (_shared/herramientas.ts) y la MISMA tabla assistant_idempotencia
// que usa Compa — confirmar dos veces produce UN solo documento, igual que ahí.
//
// verify_jwt = true (JWT de usuario normal, no OAuth): esta edge la llama la
// PERSONA desde /borrador/:id en el navegador, con su sesión normal del SGC —
// nunca el token de Claude.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");

function mensajeExito(tipo: string): string {
  return tipo === "conduce" ? "Conduce creado. Queda pendiente de firma por el flujo normal."
    : tipo === "requisicion" ? "Requisición creada y enviada a aprobación."
    : tipo === "ruta" ? "Ruta asignada. Queda planificada para el chofer."
    : "Tarea creada y asignada.";
}

// Resumen con nombres resueltos para la pantalla (lo no seguro no se marca
// aquí con certeza — eso lo decide quien preparó el borrador; mostramos lo
// que hay y dejamos "Editar antes de crear" como salida segura siempre).
async function resolverDetalle(supabase: Any, tool: string, params: Any) {
  const lineas: { etiqueta: string; valor: string }[] = [];
  const nombreObra = async (id: string) => {
    if (!id) return null;
    const { data } = await supabase.from("proyectos").select("nombre, codigo").eq("id", id).maybeSingle();
    return data ? (data.codigo ? `${data.codigo} · ${data.nombre}` : data.nombre) : id;
  };
  const nombresArticulos = async (ids: string[]) => {
    if (!ids.length) return new Map<string, string>();
    const { data } = await supabase.from("articulos").select("id, nombre").in("id", ids);
    return new Map((data ?? []).map((a: Any) => [a.id, a.nombre]));
  };
  const nombreUsuario = async (id: string) => {
    if (!id) return null;
    const { data } = await supabase.from("usuarios").select("nombre").eq("id", id).maybeSingle();
    return data?.nombre ?? id;
  };

  if (tool === "proponer_tarea") {
    lineas.push({ etiqueta: "Título", valor: params.titulo ?? "" });
    lineas.push({ etiqueta: "Obra", valor: (await nombreObra(params.proyecto_id)) ?? "" });
    if (params.asignado_a) lineas.push({ etiqueta: "Asignada a", valor: (await nombreUsuario(params.asignado_a)) ?? "" });
    lineas.push({ etiqueta: "Prioridad", valor: params.prioridad ?? "media" });
    if (params.fecha_limite) lineas.push({ etiqueta: "Fecha límite", valor: params.fecha_limite });
  } else if (tool === "proponer_requisicion" || tool === "proponer_conduce") {
    const items: Any[] = params.items ?? [];
    const map = await nombresArticulos(items.map((i) => i.articulo_id));
    if (tool === "proponer_conduce") {
      const { data: b } = await supabase.from("bodegas").select("nombre").eq("id", params.bodega_id).maybeSingle();
      lineas.push({ etiqueta: "Origen (almacén)", valor: b?.nombre ?? params.bodega_id ?? "" });
      lineas.push({ etiqueta: "Destino (obra)", valor: (await nombreObra(params.proyecto_id)) ?? "" });
    } else {
      lineas.push({ etiqueta: "Obra", valor: (await nombreObra(params.proyecto_id)) ?? "" });
      lineas.push({ etiqueta: "Urgencia", valor: params.urgencia ?? "media" });
    }
    for (const it of items) {
      lineas.push({ etiqueta: "Artículo", valor: `${map.get(it.articulo_id) ?? it.articulo_id} × ${it.cantidad}${it.unidad ? " " + it.unidad : ""}` });
    }
  } else if (tool === "proponer_ruta") {
    lineas.push({ etiqueta: "Chofer", valor: (await nombreUsuario(params.conductor_usuario_id)) ?? "" });
    if (params.vehiculo_id) {
      const { data: v } = await supabase.from("vehiculos").select("placa, marca").eq("id", params.vehiculo_id).maybeSingle();
      if (v) lineas.push({ etiqueta: "Vehículo", valor: `${v.placa ?? ""} ${v.marca ?? ""}`.trim() });
    }
    if (params.proyecto_id) lineas.push({ etiqueta: "Destino (obra)", valor: (await nombreObra(params.proyecto_id)) ?? "" });
  }
  return lineas;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = construirCors(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  let payload: { accion?: string; id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }
  const { accion, id } = payload;
  if (!id) return json({ error: "Falta el id del borrador." }, 400);

  const { data: cap, error: capErr } = await supabase.rpc("capacidades_asistente");
  if (capErr || !cap) return json({ error: "No pude leer tus permisos." }, 500);
  const capObj: Cap = {
    usuario_id: cap.usuario_id, nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin,
    modulos: Array.isArray(cap.modulos) ? cap.modulos : [], roles: Array.isArray(cap.roles) ? cap.roles : [],
  };

  const { data: borrador, error: bErr } = await supabase.rpc("claude_borrador_obtener", { p_id: id });
  // RLS: null si no existe o no es tuyo (y no eres admin).
  if (bErr || !borrador) return json({ error: "Borrador no encontrado." }, 404);

  if (accion === "get") {
    const detalle = await resolverDetalle(supabase, borrador.tool, borrador.params ?? {});
    return json({ borrador, detalle });
  }

  // Solo el dueño descarta/confirma (admin puede VER vía claude_borrador_obtener, no actuar).
  if (borrador.usuario_id !== capObj.usuario_id) return json({ error: "No autorizado." }, 403);

  if (accion === "descartar") {
    const { data: ok } = await supabase.rpc("claude_borrador_descartar", { p_id: id });
    return json({ ok: !!ok });
  }

  if (accion === "confirmar") {
    if (borrador.estado === "caducado") return json({ error: "Este borrador ya caducó (24 h). Pídele a Claude que lo prepare de nuevo." }, 410);
    if (borrador.estado === "descartado") return json({ error: "Este borrador ya fue descartado." }, 410);
    if (borrador.estado === "confirmado") {
      return json({ ok: true, duplicado: true, mensaje: borrador.resultado?.mensaje ?? "Ya lo habías confirmado — no se duplicó." });
    }

    const cfg = TOOLS.find((t) => t.name === borrador.tool && t.write);
    if (!cfg) return json({ error: "Herramienta no reconocida." }, 400);
    if (!(cfg.modulos === null || capObj.es_admin || cfg.modulos.some((m) => capObj.modulos.includes(m)))) {
      return json({ error: "No tienes permiso para esta acción." }, 403);
    }

    const clave = borrador.idem;
    const { error: claimErr } = await supabase.from("assistant_idempotencia")
      .insert({ clave, conversacion_id: null, tool: borrador.tool, estado: "ejecutando" });
    if (claimErr) {
      const { data: prev } = await supabase.from("assistant_idempotencia").select("resultado").eq("clave", clave).maybeSingle();
      if (prev) {
        const mensaje = prev?.resultado?.mensaje ?? "Esta acción ya la habías confirmado — no la repetí para no duplicarla.";
        await supabase.from("claude_borradores").update({ estado: "confirmado", resultado: { ok: true, mensaje } }).eq("id", id).then(() => {}, () => {});
        return json({ ok: true, duplicado: true, mensaje });
      }
    }

    let ok = false; let mensaje = "";
    try {
      const { error } = await supabase.rpc(cfg.write!.execRpc, cfg.write!.execMap(borrador.params, capObj));
      if (error) mensaje = `No se pudo completar: ${error.message}`;
      else { ok = true; mensaje = mensajeExito(cfg.write!.tipo); }
    } catch (e) {
      mensaje = `No se pudo completar: ${e instanceof Error ? e.message : "error"}`;
    }
    await supabase.from("assistant_idempotencia")
      .update({ estado: ok ? "hecho" : "error", resultado: { ok, mensaje }, updated_at: new Date().toISOString() })
      .eq("clave", clave).then(() => {}, () => {});
    if (!ok) await supabase.from("assistant_idempotencia").delete().eq("clave", clave).then(() => {}, () => {});
    await supabase.from("claude_borradores")
      .update({ estado: ok ? "confirmado" : "pendiente", resultado: { ok, mensaje } })
      .eq("id", id).then(() => {}, () => {});
    return json({ ok, mensaje });
  }

  return json({ error: "Acción no reconocida." }, 400);
});
