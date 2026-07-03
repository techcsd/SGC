import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Permanently deletes a user — only when they have zero associated
// business data anywhere in the schema (a fresh/unused test invite is the
// intended case). Deliberately does NOT try to enumerate every table that
// could reference the user in application code: nearly every FK into
// sgc.usuarios is ON DELETE NO ACTION by design (see
// sql/2026-07-03-admin-delete-user.sql), so Postgres itself refuses the
// `delete from sgc.usuarios` the moment any real record — a proyecto, a
// bitácora, a solicitud, a generated document, anything — references
// them. That refusal is caught here and turned into a clear message
// pointing at deactivation instead, which remains the right tool for any
// user with real history.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No autenticado." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Sesión inválida." }, 401);
    }
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) {
      return json({ error: "No autorizado." }, 403);
    }

    const { userId } = await req.json();
    if (typeof userId !== "string") {
      return json({ error: "Parámetros inválidos." }, 400);
    }

    if (userId === callerData.user.id) {
      return json({ error: "No puedes eliminar tu propia cuenta." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    const { data: usuario } = await admin.from("usuarios").select("email, nombre").eq("id", userId).single();

    const { error: deleteError } = await admin.from("usuarios").delete().eq("id", userId);
    if (deleteError) {
      if (deleteError.code === "23503") {
        return json(
          {
            error:
              "No se puede eliminar: este usuario tiene actividad registrada en el sistema (proyectos, bitácoras, solicitudes, documentos, etc.). Desactívalo en su lugar para revocar su acceso sin perder ese historial.",
          },
          409,
        );
      }
      return json({ error: deleteError.message }, 400);
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      return json({ error: `Perfil eliminado, pero falló al eliminar la cuenta de acceso: ${authDeleteError.message}` }, 500);
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "usuario_eliminado",
      target_user_id: null,
      metadata: { deleted_user_id: userId, email: usuario?.email, nombre: usuario?.nombre },
    });

    return json({ userId, deleted: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
