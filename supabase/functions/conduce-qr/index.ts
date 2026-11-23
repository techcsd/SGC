import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import { esTipoDocQr, firmarTokenDoc, TIPOS_DOC_QR, verificarTokenDoc } from "../_shared/doc-qr.ts";

// DS-34/#74 + DX7 — QR por tipo de documento (nació como QR del conduce; mismo nombre de edge para no
// romper lo ya desplegado/impreso). Dos acciones, ambas con sesión (verify_jwt=true):
//   emitir   {tipo?, id | salidaId}  -> token firmado (HMAC) con vencimiento. `tipo` por defecto = conduce
//                           (API legada: {accion:'emitir', salidaId}). Solo quien VE el documento (RLS con el JWT
//                           del usuario) puede emitirlo.
//   resolver {token}         -> {tipo, id, ruta} (+ salidaId/estado para conduce, compatibilidad). Solo comprueba
//                           firma, vencimiento y que el documento exista; el QR NO otorga permisos: la pantalla
//                           destino y la RLS deciden. Cada escaneo queda en sgc.doc_qr_escaneos (quién/cuándo).
// Secret requerido: CONDUCE_QR_SECRET. Interruptores: parametros.conduce_qr_activo (conduce) y
// parametros.doc_qr_<tipo>_activo (resto, apagados por defecto).

const SI = ["true", "t", "1", "si", "sí"];

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
    const claves = ["conduce_qr_vigencia_dias", "doc_qr_vigencia_dias", ...Object.values(TIPOS_DOC_QR).map((t) => t.claveActivo)];
    const { data: params } = await admin.from("parametros").select("clave, valor").in("clave", claves);
    const p = Object.fromEntries((params ?? []).map((r: { clave: string; valor: string }) => [r.clave, r.valor]));
    const activo = (tipo: keyof typeof TIPOS_DOC_QR) => SI.includes(String(p[TIPOS_DOC_QR[tipo].claveActivo] ?? "false").toLowerCase());

    const cuerpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const accion = cuerpo.accion;
    const token = cuerpo.token;

    if (accion === "emitir") {
      const tipo = (cuerpo.tipo ?? "conduce") as string;
      const id = String(cuerpo.id ?? cuerpo.salidaId ?? "");
      if (!esTipoDocQr(tipo) || !id) return json({ error: "Parámetros inválidos." }, 400);
      if (!activo(tipo)) return json({ error: "qr_desactivado" }, 409);
      const cfg = TIPOS_DOC_QR[tipo];

      // Visibilidad con el JWT del usuario (RLS de la tabla del documento).
      const { data: fila, error } = await caller.schema("sgc").from(cfg.tabla).select("id").eq("id", id).maybeSingle();
      let permitido = !error && !!fila;
      // Un confirmador designado de un conduce puede no verlo por RLS: se valida con la matriz canónica (AK4).
      if (!permitido && tipo === "conduce") {
        const { data: esConf } = await caller.schema("sgc").rpc("es_confirmador_de_conduce", { p_salida_id: id });
        permitido = esConf === true;
      }
      if (!permitido) return json({ error: "sin_acceso" }, 403);

      const clave = tipo === "conduce" ? "conduce_qr_vigencia_dias" : "doc_qr_vigencia_dias";
      const dias = Math.min(Math.max(Number(p[clave]) || cfg.vigenciaDias, 1), 365);
      const exp = Math.floor(Date.now() / 1000) + dias * 86400;
      return json({ token: await firmarTokenDoc(secreto, tipo, id, exp), exp, tipo });
    }

    if (accion === "resolver") {
      const r = await verificarTokenDoc(secreto, String(token ?? ""), Math.floor(Date.now() / 1000));
      if (!r.ok) return json({ error: `token_${r.motivo}` }, r.motivo === "vencido" ? 410 : 400);
      if (!activo(r.tipo)) return json({ error: "qr_desactivado" }, 409);
      const cfg = TIPOS_DOC_QR[r.tipo];
      const { data: doc } = await admin.from(cfg.tabla).select("id, estado").eq("id", r.id).maybeSingle();
      // Registro de escaneo (quién/cuándo). Nunca bloquea la respuesta.
      try {
        await admin.from("doc_qr_escaneos").insert({ tipo: r.tipo, doc_id: r.id, usuario_id: u.user.id, resultado: doc ? "ok" : "no_encontrado" });
      } catch (_) { /* trace must never block */ }
      if (!doc) return json({ error: "no_encontrado" }, 404);
      return json({ tipo: r.tipo, id: doc.id, ruta: cfg.ruta(doc.id), salidaId: r.tipo === "conduce" ? doc.id : undefined, estado: doc.estado });
    }

    return json({ error: "Acción inválida." }, 400);
  } catch (e) {
    console.error("conduce-qr", e instanceof Error ? e.message : e);
    return json({ error: "Error interno.", error_code: "error_interno" }, 500);
  }
});
