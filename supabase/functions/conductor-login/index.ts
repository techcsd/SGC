import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// P5 — Login de conductor por cédula + PIN (público, pre-auth: verify_jwt=false).
// Mapea la cédula a su email sintético y hace signInWithPassword. Aplica bloqueo
// temporal por intentos fallidos (tabla sgc.conductor_login_intentos, service
// role). Devuelve la sesión (tokens) para que el front haga setSession.

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

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

function syntheticEmail(cedula: string): string {
  const digits = (cedula || "").replace(/\D/g, "");
  return `c-${digits}@conductores.constructorasd.local`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { cedula, pin } = await req.json();
    if (typeof cedula !== "string" || !cedula.trim() || typeof pin !== "string" || !pin) {
      return json({ error: "Cédula y PIN son requeridos." }, 400);
    }
    const cedulaKey = cedula.replace(/\D/g, "");
    if (!cedulaKey) return json({ error: "Cédula inválida." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, { db: { schema: "sgc" } });
    const now = new Date();

    // 1) Bloqueo activo
    const { data: intento } = await admin
      .from("conductor_login_intentos")
      .select("intentos, bloqueado_hasta")
      .eq("cedula", cedulaKey)
      .maybeSingle();

    const bloqueadoHasta = intento?.bloqueado_hasta ? new Date(intento.bloqueado_hasta) : null;
    const bloqueado = bloqueadoHasta && bloqueadoHasta > now;
    if (bloqueado) {
      const retryInSeconds = Math.ceil((bloqueadoHasta!.getTime() - now.getTime()) / 1000);
      return json(
        { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo.", locked: true, retryInSeconds },
        429,
      );
    }

    // 2) Intentar login
    const email = syntheticEmail(cedula);
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (signInError || !signIn.session) {
      // Contar fallo (si el bloqueo anterior ya pasó, empezar de cero).
      const base = bloqueadoHasta && bloqueadoHasta <= now ? 0 : (intento?.intentos ?? 0);
      const intentos = base + 1;
      const alcanzoLimite = intentos >= MAX_INTENTOS;
      const nuevoBloqueo = alcanzoLimite ? new Date(now.getTime() + BLOQUEO_MIN * 60_000) : null;
      await admin.from("conductor_login_intentos").upsert(
        {
          cedula: cedulaKey,
          intentos: alcanzoLimite ? 0 : intentos, // al bloquear, reinicia el contador
          bloqueado_hasta: nuevoBloqueo,
          ultimo_intento: now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "cedula" },
      );
      if (alcanzoLimite) {
        return json(
          { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo.", locked: true, retryInSeconds: BLOQUEO_MIN * 60 },
          429,
        );
      }
      return json({ error: "Cédula o PIN incorrectos." }, 401);
    }

    // 3) Éxito → limpiar intentos y devolver la sesión.
    await admin.from("conductor_login_intentos").delete().eq("cedula", cedulaKey);
    return json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_in: signIn.session.expires_in,
      expires_at: signIn.session.expires_at,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
