import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";
import {
  ESTADOS_ABIERTOS,
  faltantesEnDev,
  filaParaDev,
  mismaBase,
  parcheParaProd,
  type TareaFila,
} from "../_shared/agente-ingeniero-espejo-lib.ts";

// ============================================================================
// agente-ingeniero-espejo -- pg_cron (x-sync-secret). Corre en PROD.
//   1) Copia a dev (MISMO id) las tareas 'nueva' del Ingeniero que aun no existen alli.
//   2) Trae de vuelta a prod el estado/PR de las tareas abiertas, para Tecnologia > Agentes.
// El runner de GitHub solo conoce dev; nunca recibe credenciales de prod. Esta edge guarda la llave de dev
// (secrets ESPEJO_DEV_URL / ESPEJO_DEV_SERVICE_ROLE_KEY) y NO escribe nada en prod salvo esas tareas.
// Sin esos secrets = no-op inerte (asi queda en dev). Con {"dry":true} solo informa.
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const body = await req.json().catch(() => ({}));
  const dry = body?.dry === true;
  const devUrl = Deno.env.get("ESPEJO_DEV_URL");
  const devKey = Deno.env.get("ESPEJO_DEV_SERVICE_ROLE_KEY");
  if (!devUrl || !devKey) return json({ ok: true, inerte: true, motivo: "sin_secrets_de_dev" });
  if (mismaBase(devUrl, SUPABASE_URL)) return json({ ok: false, error: "ESPEJO_DEV_URL apunta a esta misma base" }, 500);

  const prod = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" } });
  const dev = createClient(devUrl, devKey, { db: { schema: "sgc" } });
  const { data: agente } = await prod.from("agentes").select("id").eq("clave", "ingeniero").maybeSingle();
  const evento = async (estado: string, resumen: string, ev: Record<string, unknown> = {}) => {
    if (agente?.id) await prod.from("agente_eventos").insert({ agente_id: agente.id, tipo: "espejo", estado, resumen, evidencia_json: ev });
  };

  try {
    // 1) prod -> dev: tareas nuevas que faltan
    const { data: nuevas, error: e1 } = await prod.from("agente_ingeniero_tareas").select("*").eq("estado", "nueva").order("creada_en").limit(50);
    if (e1) throw new Error(`leer nuevas: ${e1.message}`);
    const ids = (nuevas ?? []).map((t) => t.id as string);
    let copiadas = 0;
    if (ids.length) {
      const { data: enDev, error: e2 } = await dev.from("agente_ingeniero_tareas").select("id").in("id", ids);
      if (e2) throw new Error(`leer dev: ${e2.message}`);
      const faltan = new Set(faltantesEnDev(ids, new Set((enDev ?? []).map((r) => r.id as string))));
      const filas = (nuevas ?? []).filter((t) => faltan.has(t.id as string)).map((t) => filaParaDev(t as TareaFila));
      if (filas.length && !dry) {
        const { error: e3 } = await dev.from("agente_ingeniero_tareas").insert(filas);
        if (e3) throw new Error(`insertar en dev: ${e3.message}`);
      }
      copiadas = filas.length;
    }

    // 2) dev -> prod: estado/PR de las tareas abiertas
    const { data: abiertas, error: e4 } = await prod.from("agente_ingeniero_tareas").select("*").in("estado", [...ESTADOS_ABIERTOS]).limit(200);
    if (e4) throw new Error(`leer abiertas: ${e4.message}`);
    const idsAb = (abiertas ?? []).map((t) => t.id as string);
    let sincronizadas = 0;
    if (idsAb.length) {
      const { data: devFilas, error: e5 } = await dev.from("agente_ingeniero_tareas").select("*").in("id", idsAb);
      if (e5) throw new Error(`leer dev (sync): ${e5.message}`);
      const porId = new Map((devFilas ?? []).map((r) => [r.id as string, r]));
      for (const p of abiertas ?? []) {
        const d = porId.get(p.id as string);
        if (!d) continue;
        const patch = parcheParaProd(d, p);
        if (Object.keys(patch).length === 0) continue;
        if (!dry) {
          const { error } = await prod.from("agente_ingeniero_tareas").update(patch).eq("id", p.id);
          if (error) throw new Error(`actualizar prod ${p.id}: ${error.message}`);
        }
        sincronizadas++;
      }
    }

    if (!dry && (copiadas || sincronizadas)) await evento("observando", `Espejo: ${copiadas} copiadas a dev, ${sincronizadas} sincronizadas`, { copiadas, sincronizadas });
    return json({ ok: true, dry, copiadas, sincronizadas });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (!dry) await evento("error", `Espejo fallo: ${msg}`.slice(0, 300));
    return json({ ok: false, error: msg }, 500);
  }
});
