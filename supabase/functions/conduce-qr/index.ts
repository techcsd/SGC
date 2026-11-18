import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { firmarTokenConduce, verificarTokenConduce } from "../_shared/conduce-qr.ts";

// DS-34/#74 — QR del conduce. Dos acciones, ambas con sesión (verify_jwt=true):
//   emitir   {salidaId}  -> token firmado (HMAC, vencimiento en días = parámetro conduce_qr_vigencia_dias).
//                           Solo quien VE el conduce (RLS con el JWT del usuario) puede emitirlo.
//   resolver {token}     -> {salidaId, estado}. Solo comprueba firma y vencimiento; los datos del conduce y la
//                           recepción siguen gobernados por la RLS y por conduce_confirmar_receptor.
// Secret requerido: CONDUCE_QR_SECRET. Flag: parametros.conduce_qr_activo (apagado por defecto).

Deno.serve(async (req: Request) => {
  const cors = construirCors(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "No autenticado." }, 401);
    const caller = createClient(envRequerido("SUPABASE_URL"), envRequerido("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await caller.auth.getUser();
    if (uErr || !u.user) return json({ error: "Sesión inválida." }, 401);

    const secreto = Deno.env.get("CONDUCE_QR_SECRET");
    if (!secreto) return json({ error: "qr_no_configurado" }, 503);

    const admin = createClient(envRequerido("SUPABASE_URL"), envRequerido("SUPABASE_SERVICE_ROLE_KEY"), {
      db: { schema: "sgc" },
    });
    const { data: params } = await admin.from("parametros").select("clave, valor")
      .in("clave", ["conduce_qr_activo", "conduce_qr_vigencia_dias"]);
    const p = Object.fromEntries((params ?? []).map((r: { clave: string; valor: string }) => [r.clave, r.valor]));
    if (!["true", "t", "1", "si", "sí"].includes(String(p.conduce_qr_activo ?? "false").toLowerCase())) {
      return json({ error: "qr_desactivado" }, 409);
    }

    const { accion, salidaId, token } = await req.json();

    if (accion === "emitir") {
      if (typeof salidaId !== "string") return json({ error: "Parámetros inválidos." }, 400);
      // Visibilidad con el JWT del usuario (RLS de salidas_inventario).
      const { data: fila, error } = await caller.schema("sgc").from("salidas_inventario")
        .select("id").eq("id", salidaId).maybeSingle();
      // Un confirmador designado puede no ver la salida por RLS: se valida tambien con la matriz canonica (AK4).
      let permitido = !error && !!fila;
      if (!permitido) {
        const { data: esConf } = await caller.schema("sgc").rpc("es_confirmador_de_conduce", { p_salida_id: salidaId });
        permitido = esConf === true;
      }
      if (!permitido) return json({ error: "sin_acceso" }, 403);
      const dias = Math.min(Math.max(Number(p.conduce_qr_vigencia_dias) || 30, 1), 365);
      const exp = Math.floor(Date.now() / 1000) + dias * 86400;
      return json({ token: await firmarTokenConduce(secreto, salidaId, exp), exp });
    }

    if (accion === "resolver") {
      const r = await verificarTokenConduce(secreto, String(token ?? ""), Math.floor(Date.now() / 1000));
      if (!r.ok) return json({ error: `token_${r.motivo}` }, r.motivo === "vencido" ? 410 : 400);
      const { data: s } = await admin.from("salidas_inventario").select("id, estado").eq("id", r.salidaId).maybeSingle();
      if (!s) return json({ error: "no_encontrado" }, 404);
      return json({ salidaId: s.id, estado: s.estado });
    }

    return json({ error: "Acción inválida." }, 400);
  } catch (e) {
    console.error("conduce-qr", e instanceof Error ? e.message : e);
    return json({ error: "Error interno." }, 500);
  }
});
