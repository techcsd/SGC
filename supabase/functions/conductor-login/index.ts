import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// P5 — Login por cédula + PIN (público, pre-auth: verify_jwt=false).
// AX2 — GENERALIZADO por rol: la misma cédula puede pertenecer a un CHOFER
// (email sintético `c-<digits>@conductores…`) o a un CAPATAZ
// (`cap-<digits>@personal…`, creado por la edge `acceso-cedula`). El login es
// ROL-AGNÓSTICO: prueba los dominios en orden y autentica el que exista — el
// front (app) no necesita saber el rol, lo resuelve el backend. Retrocompatible:
// el dominio de chofer va primero, así el flujo existente no cambia.
// Aplica bloqueo temporal por intentos fallidos (tabla sgc.conductor_login_intentos,
// service role, keyed por cédula). Devuelve la sesión (tokens) para setSession.

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

// AX2 — dominios de email sintético por rol, en orden de intento. El de chofer
// va primero (retrocompatibilidad). Añadir un rol nuevo = una línea aquí + su
// creación de acceso en `acceso-cedula` (misma llave: la cédula en dígitos).
const EMAIL_DOMINIOS: ReadonlyArray<(digits: string) => string> = [
  (d) => `c-${d}@conductores.constructorasd.local`, // chofer (P5)
  (d) => `cap-${d}@personal.constructorasd.local`, // capataz (acceso-cedula)
];

function emailsCandidatos(cedula: string): string[] {
  const digits = (cedula || "").replace(/\D/g, "");
  return EMAIL_DOMINIOS.map((f) => f(digits));
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

    // 2) Intentar login — AX2: prueba cada dominio de rol; gana el que exista.
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    let sesion: { access_token: string; refresh_token: string; expires_in: number; expires_at?: number } | null = null;
    for (const email of emailsCandidatos(cedula)) {
      const { data: signIn } = await anon.auth.signInWithPassword({ email, password: pin });
      if (signIn?.session) {
        sesion = signIn.session;
        break;
      }
    }

    if (!sesion) {
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
      access_token: sesion.access_token,
      refresh_token: sesion.refresh_token,
      expires_in: sesion.expires_in,
      expires_at: sesion.expires_at,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Error desconocido." }, 500);
  }
});
