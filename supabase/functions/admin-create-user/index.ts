import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates a real Supabase Auth user (Admin API — service_role only, never
// exposed to the frontend) plus the matching sgc.usuarios row and initial
// role assignment, invite-flow (the user sets their own password via an
// emailed link — the admin never sees or sets it). If the profile/role
// insert fails after the auth user was created, the auth user is deleted
// so we never leave an orphaned auth.users row with no profile.
//
// Every call independently re-verifies the caller is authenticated AND
// holds the admin module — this function does not trust the frontend.

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

    // Verify the caller's JWT and admin status using their own token —
    // this reuses the exact same sgc.is_admin() check RLS relies on
    // everywhere else, rather than re-implementing the logic here.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: "Sesión inválida." }, 401);
    }
    const { data: isAdmin } = await callerClient.schema("sgc").rpc("is_admin");
    if (!isAdmin) {
      return json({ error: "No autorizado. Solo un administrador puede crear usuarios." }, 403);
    }

    const { email, fullName, roleId } = await req.json();
    if (typeof email !== "string" || !email.includes("@") || typeof fullName !== "string" || !fullName.trim()) {
      return json({ error: "Correo y nombre completo son requeridos." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });

    const { data: created, error: createError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nombre: fullName.trim() },
    });
    if (createError || !created.user) {
      return json({ error: createError?.message ?? "Error al crear el usuario." }, 400);
    }
    const newUserId = created.user.id;

    const { error: profileError } = await admin
      .from("usuarios")
      .insert({ id: newUserId, nombre: fullName.trim(), email, activo: true });

    if (profileError) {
      await admin.auth.admin.deleteUser(newUserId);
      return json({ error: `No se pudo crear el perfil, se revirtió la creación: ${profileError.message}` }, 400);
    }

    if (roleId != null) {
      const { error: roleError } = await admin
        .from("usuarios_roles")
        .insert({ usuario_id: newUserId, rol_id: roleId, asignado_por: callerData.user.id });

      if (roleError) {
        await admin.from("usuarios").delete().eq("id", newUserId);
        await admin.auth.admin.deleteUser(newUserId);
        return json({ error: `No se pudo asignar el rol, se revirtió la creación: ${roleError.message}` }, 400);
      }
    }

    await admin.from("audit_log").insert({
      actor_id: callerData.user.id,
      action: "usuario_creado",
      target_user_id: newUserId,
      metadata: { email, fullName, roleId },
    });

    return json({ userId: newUserId, email, fullName });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
