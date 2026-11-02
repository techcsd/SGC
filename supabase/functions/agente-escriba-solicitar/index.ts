import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sanearEvidencia } from "./saneo.ts";

// ============================================================================
// DF2/F4 — agente-escriba-solicitar. Recibe un hallazgo de sgc.agente_hallazgos
// y le pide al Agente Escriba (Nivel 3, GitHub Actions + claude-code-action)
// que proponga un arreglo vía PR a `dev`. Esto NUNCA aplica el fix — solo
// dispara el workflow y deja un registro "pendiente" en sgc.agente_aprobaciones
// para que Xaviel lo revise desde Tecnología › Agentes (F5).
//
// Decisión de diseño: se dispara el workflow directo vía `workflow_dispatch`
// de la API de GitHub (no se crea un issue con etiqueta) — es un solo request,
// no depende de que GitHub procese la etiqueta a tiempo, y evita dejar issues
// huérfanos si el dispatch falla a medio camino.
//
// Secreto pendiente de Xaviel (Supabase → Edge Functions → Secrets, proyecto
// DEV primero por Regla 18): `AGENTE_ESCRIBA_GITHUB_TOKEN` — un GitHub PAT
// fine-grained con permiso "Actions: write" sobre este repo (para poder
// disparar workflow_dispatch desde fuera de GitHub Actions; el token por
// defecto de Actions no sirve para esto, solo funciona DENTRO de un job ya
// corriendo). Sin este secreto, responde 501 `github_no_configurado` — no
// rompe nada más del sistema de agentes.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_REPO = Deno.env.get("AGENTE_ESCRIBA_GITHUB_REPO") ?? "techcsd/SGC";
const GITHUB_WORKFLOW_FILE = "agente-escriba.yml";
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.replace("Bearer ", "")) {
    return json(req, { error: "No autenticado", error_code: "no_auth" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user?.id) return json(req, { error: "Sesión inválida", error_code: "sesion_invalida" }, 401);

  const [{ data: esAdmin }, { data: esTec }] = await Promise.all([
    userClient.schema("sgc").rpc("is_admin"),
    userClient.schema("sgc").rpc("es_tecnologia"),
  ]);
  if (!esAdmin && !esTec) {
    return json(
      req,
      { error: "Solo Administración o Tecnología pueden pedirle código al Escriba.", error_code: "no_autorizado" },
      403,
    );
  }

  let hallazgoId: string | undefined;
  try {
    ({ hallazgo_id: hallazgoId } = await req.json());
  } catch {
    return json(req, { error: "Cuerpo inválido", error_code: "body_invalido" }, 400);
  }
  if (!hallazgoId) return json(req, { error: "Falta hallazgo_id", error_code: "falta_hallazgo_id" }, 400);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });

  const { data: hallazgo, error: errHallazgo } = await svc
    .from("agente_hallazgos")
    .select("id, agente_id, titulo, detalle")
    .eq("id", hallazgoId)
    .maybeSingle();
  if (errHallazgo || !hallazgo) {
    return json(req, { error: "Hallazgo no encontrado", error_code: "hallazgo_no_encontrado" }, 404);
  }

  const { data: escriba } = await svc.from("agentes").select("id").eq("clave", "escriba").maybeSingle();

  const descripcionSaneada = sanearEvidencia(`${hallazgo.titulo}\n\n${hallazgo.detalle ?? ""}`);

  // Deja el registro "pendiente" ANTES de llamar a GitHub — si el dispatch
  // falla, igual queda evidencia de que se pidió, con el detalle de por qué.
  const { data: aprobacion } = await svc
    .from("agente_aprobaciones")
    .insert({ agente_id: escriba?.id ?? null, propuesta: descripcionSaneada, estado: "pendiente" })
    .select("id")
    .single();

  const ghToken = Deno.env.get("AGENTE_ESCRIBA_GITHUB_TOKEN");
  if (!ghToken) {
    return json(
      req,
      {
        error: "El Agente Escriba aún no está configurado (falta el token de GitHub).",
        error_code: "github_no_configurado",
        aprobacion_id: aprobacion?.id ?? null,
      },
      501,
    );
  }

  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "dev",
        inputs: {
          hallazgo_id: hallazgoId,
          descripcion: descripcionSaneada,
          // El workflow usa esto para nombrar la rama (feature/agente-<slug>) —
          // así agente-escriba-estado puede emparejar el PR con esta fila exacta
          // sin ambigüedad, en vez de adivinar "la primera pendiente sin pr_url".
          aprobacion_id: aprobacion?.id ?? "",
        },
      }),
    },
  );

  if (!resp.ok) {
    const detalle = await resp.text();
    // No dejar la fila "pendiente" para siempre -- sin esto nunca llega un PR
    // y el panel "Esperan tu OK" la mostraría como si el Escriba la estuviera
    // trabajando. Se marca descartada con el error como evidencia.
    if (aprobacion?.id) {
      await svc
        .from("agente_aprobaciones")
        .update({ estado: "descartada", pruebas_resultado: `dispatch_fallido: ${detalle.slice(0, 300)}` })
        .eq("id", aprobacion.id);
    }
    return json(
      req,
      {
        error: "GitHub rechazó el dispatch del Escriba.",
        error_code: "github_dispatch_fallo",
        detalle_tecnico: detalle.slice(0, 300),
        aprobacion_id: aprobacion?.id ?? null,
      },
      502,
    );
  }

  return json(req, { ok: true, aprobacion_id: aprobacion?.id ?? null }, 200);
});
