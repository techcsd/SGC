import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { envRequerido } from "../_shared/env.ts";

// DG7 — purga diaria de la papelera de imágenes quitadas de notas (30 días).
// Borra el archivo real del bucket `notas-imagenes` y la fila de
// `sgc.nota_imagenes_quitadas` para cada registro con purgar_en < now().
// Invocada por pg_cron (`sgc-purgar-imagenes-notas`) vía net.http_post con
// x-sync-secret — mismo patrón que check-domains/fuel-prices. --no-verify-jwt.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const LOTE = 500;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const secret = req.headers.get("x-sync-secret");
  if (!secret || secret !== Deno.env.get("INFRA_SYNC_SECRET")) return json({ error: "No autorizado." }, 401);

  const sb = createClient(
    envRequerido("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "sgc" } },
  );

  const { data: filas, error } = await sb
    .from("nota_imagenes_quitadas")
    .select("id, ruta_storage")
    .lt("purgar_en", new Date().toISOString())
    .limit(LOTE);
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!filas?.length) return json({ ok: true, purgadas: 0 });

  const rutas = [...new Set((filas as { ruta_storage: string }[]).map((f) => f.ruta_storage).filter(Boolean))];
  let errorStorage: string | null = null;
  if (rutas.length) {
    const { error: errStorage } = await sb.storage.from("notas-imagenes").remove(rutas);
    // Best-effort: un archivo ya ausente (p. ej. borrado a mano antes) no debe
    // bloquear la limpieza de las filas — solo se reporta.
    if (errStorage) errorStorage = errStorage.message;
  }

  const ids = (filas as { id: string }[]).map((f) => f.id);
  const { error: errDelete } = await sb.from("nota_imagenes_quitadas").delete().in("id", ids);
  if (errDelete) return json({ ok: false, error: errDelete.message }, 500);

  return json({ ok: true, purgadas: ids.length, error_storage: errorStorage });
});
