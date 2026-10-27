import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders as construirCors } from "../_shared/cors.ts";
import { envRequerido } from "../_shared/env.ts";
import {
  importarLlaveMaestra, toHexBytea, fromHexBytea, cifrarBytes, descifrarBytes, cifrarTexto, descifrarTexto, totpCodigo,
} from "./cripto.ts";

// ============================================================================
// CZ3/CZ9 — Vault ("Bóveda") de Administración. ÚNICA edge que toca secretos
// en claro (AES-256-GCM con la llave maestra `BOVEDA_MASTER_KEY`, distinta por
// entorno — scripts/boveda-generar-clave.mjs). Gate de ROL estricto
// (sgc.puede_ver_vault() = is_admin()), nunca el módulo `admin` (ver
// docs/SUBMODULOS-SENSIBLES.md). Solo rol Administrador (decisión de Xaviel).
//
// Reglas de seguridad de esta pieza (no negociables):
//   - El valor en claro NUNCA se registra en logs ni en `boveda_accesos`.
//   - Cada acción (salvo `sesion_abrir`) exige una `boveda_sesiones` vigente —
//     reautenticación con contraseña real (signInWithPassword), nunca el JWT
//     que ya traía el cliente.
//   - `Cache-Control: no-store` en toda respuesta.
//   - Nunca alcanzable desde el conector de Claude (rechazar_si_cliente_oauth,
//     DZ-15 — espejo del guard `verify-boveda-fuera-de-ia.mjs`).
//
//   Entrada (POST, JWT del usuario):
//     { accion: 'sesion_abrir'|'revelar'|'mostrar_semilla'|'codigo_2fa'|
//               'crear'|'editar'|'eliminar'|'descartar'|'restaurar'|'copiar_evento'|
//               'archivo_subir'|'archivo_descargar',
//       ...parámetros de la acción }
// ============================================================================

const SUPABASE_URL = envRequerido("SUPABASE_URL");
const SUPABASE_ANON_KEY = envRequerido("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SESION_MINUTOS: Record<string, number> = { web: 5, app: 2 };
const VALOR_VISIBLE_SEG = 30;
const MAX_FALLOS = 3;
const BLOQUEO_MINUTOS = 15;

// deno-lint-ignore no-explicit-any
type Any = any;

// ── Crypto: AES-256-GCM, IV 96 bits, AAD = id de la entrada ─────────────────
// (primitivas en ./cripto.ts, probadas sin red en ./cripto.test.ts)
let masterKeyPromise: Promise<CryptoKey> | null = null;
function masterKey(): Promise<CryptoKey> {
  if (!masterKeyPromise) masterKeyPromise = importarLlaveMaestra(envRequerido("BOVEDA_MASTER_KEY"));
  return masterKeyPromise;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...construirCors(req), "Cache-Control": "no-store" };
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autenticado." }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).schema("sgc");

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ ok: false, error: "Sesión inválida." }, 401);
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? "";

  // DZ-15 — el conector de Claude (OAuth) nunca alcanza el Vault.
  const { error: oauthErr } = await userClient.schema("sgc").rpc("rechazar_si_cliente_oauth");
  if (oauthErr) return json({ ok: false, error: "Esta acción no está permitida desde un conector externo." }, 403);

  // DZ-08 — gate de ROL estricto (is_admin), no el módulo `admin`.
  const { data: puedeVault } = await userClient.schema("sgc").rpc("puede_ver_vault");
  if (!puedeVault) return json({ ok: false, error: "No autorizado." }, 403);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const plataforma: "web" | "app" = req.headers.get("x-sgc-client") === "app" ? "app" : "web";

  async function auditar(accion: string, entradaId?: string | null, detalle?: string) {
    await svc.from("boveda_accesos").insert({
      usuario_id: userId, entrada_id: entradaId ?? null, accion, detalle: detalle ?? null, ip, user_agent: userAgent,
    });
  }

  async function sesionVigente(): Promise<boolean> {
    const { data } = await svc
      .from("boveda_sesiones")
      .select("expira_at")
      .eq("usuario_id", userId)
      .gt("expira_at", new Date().toISOString())
      .order("expira_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Cuerpo inválido." }, 400);
  }
  const accion = body?.accion;

  try {
    // ── sesion_abrir — la ÚNICA acción que NO exige sesión previa ───────────
    if (accion === "sesion_abrir") {
      const { data: intento } = await svc.from("boveda_intentos").select("*").eq("usuario_id", userId).maybeSingle();
      if (intento?.bloqueado_hasta && new Date(intento.bloqueado_hasta) > new Date()) {
        return json({ ok: false, error: `Bloqueado por intentos fallidos. Intenta de nuevo después de ${new Date(intento.bloqueado_hasta).toLocaleTimeString("es-DO")}.` }, 423);
      }
      const password = String(body?.password ?? "");
      if (!password) return json({ ok: false, error: "Escribe tu contraseña." }, 400);

      const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: signIn, error: signInErr } = await verifyClient.auth.signInWithPassword({ email: userEmail, password });
      if (signInErr || signIn.user?.id !== userId) {
        const fallos = (intento?.fallos ?? 0) + 1;
        const bloqueado = fallos >= MAX_FALLOS;
        const { error: upsertErr } = await svc.from("boveda_intentos").upsert({
          usuario_id: userId, fallos: bloqueado ? 0 : fallos,
          bloqueado_hasta: bloqueado ? new Date(Date.now() + BLOQUEO_MINUTOS * 60_000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "usuario_id" });
        if (upsertErr) console.error("boveda_intentos upsert (fallo) error:", upsertErr.message);
        await auditar("fallo_reautenticacion");
        if (bloqueado) {
          await auditar("bloqueo", null, `${MAX_FALLOS} fallos seguidos`);
          // Aviso al admin — best-effort, nunca bloquea la respuesta.
          try {
            const { data: admins } = await svc.from("usuarios").select("email").limit(50);
            void admins; // el envío real de correo reusa el canal de notificaciones existente (fuera de esta edge).
          } catch { /* best-effort */ }
          return json({ ok: false, error: `Demasiados intentos. Bloqueado ${BLOQUEO_MINUTOS} minutos.` }, 423);
        }
        return json({ ok: false, error: "Contraseña incorrecta." }, 401);
      }

      const { error: resetErr } = await svc.from("boveda_intentos").upsert(
        { usuario_id: userId, fallos: 0, bloqueado_hasta: null, updated_at: new Date().toISOString() },
        { onConflict: "usuario_id" },
      );
      if (resetErr) console.error("boveda_intentos upsert (reset) error:", resetErr.message);
      const expiraAt = new Date(Date.now() + SESION_MINUTOS[plataforma] * 60_000).toISOString();
      await svc.from("boveda_sesiones").insert({ usuario_id: userId, plataforma, expira_at: expiraAt });
      await auditar("abrir_sesion");
      return json({ ok: true, expira_at: expiraAt });
    }

    // ── Todo lo demás exige sesión de Vault vigente ─────────────────────────
    if (!(await sesionVigente())) {
      return json({ ok: false, error: "Tu sesión del Vault expiró. Vuelve a entrar tu contraseña.", error_code: "sesion_vencida" }, 401);
    }

    if (accion === "crear") {
      const { tipo, nombre, sitio_url, usuario_texto, valor, etiquetas, rotar_cada_dias, notas } = body;
      if (!tipo || !nombre) return json({ ok: false, error: "Tipo y nombre son obligatorios." }, 400);
      const id = crypto.randomUUID();
      let valorCifradoHex: string | null = null, ivHex: string | null = null;
      if (typeof valor === "string" && valor.length) {
        const { cifrado, iv } = await cifrarTexto(await masterKey(), valor, id);
        valorCifradoHex = toHexBytea(cifrado);
        ivHex = toHexBytea(iv);
      }
      const { error } = await svc.from("boveda_entradas").insert({
        id, tipo, nombre, sitio_url: sitio_url ?? null, usuario_texto: usuario_texto ?? null,
        valor_cifrado: valorCifradoHex, valor_iv: ivHex,
        etiquetas: etiquetas ?? [], rotar_cada_dias: rotar_cada_dias ?? null, notas: notas ?? null,
        creado_por: userId,
      });
      if (error) throw error;
      await auditar("crear", id, nombre);
      return json({ ok: true, id });
    }

    if (accion === "editar") {
      const { entrada_id, nombre, sitio_url, usuario_texto, valor, etiquetas, rotar_cada_dias, ultima_rotacion, notas } = body;
      if (!entrada_id) return json({ ok: false, error: "Falta la entrada." }, 400);
      // deno-lint-ignore no-explicit-any
      const update: Any = { updated_at: new Date().toISOString() };
      if (nombre !== undefined) update.nombre = nombre;
      if (sitio_url !== undefined) update.sitio_url = sitio_url;
      if (usuario_texto !== undefined) update.usuario_texto = usuario_texto;
      if (etiquetas !== undefined) update.etiquetas = etiquetas;
      if (rotar_cada_dias !== undefined) update.rotar_cada_dias = rotar_cada_dias;
      if (ultima_rotacion !== undefined) update.ultima_rotacion = ultima_rotacion;
      if (notas !== undefined) update.notas = notas;
      if (typeof valor === "string" && valor.length) {
        const { cifrado, iv } = await cifrarTexto(await masterKey(), valor, entrada_id);
        update.valor_cifrado = toHexBytea(cifrado);
        update.valor_iv = toHexBytea(iv);
      }
      const { error } = await svc.from("boveda_entradas").update(update).eq("id", entrada_id);
      if (error) throw error;
      await auditar("editar", entrada_id, nombre);
      return json({ ok: true });
    }

    if (accion === "eliminar") {
      const { entrada_id } = body;
      if (!entrada_id) return json({ ok: false, error: "Falta la entrada." }, 400);
      const { data: fila } = await svc.from("boveda_entradas").select("archivo_path, nombre").eq("id", entrada_id).maybeSingle();
      await auditar("eliminar", entrada_id, fila?.nombre);
      if (fila?.archivo_path) {
        await svc.storage.from("boveda-archivos").remove([fila.archivo_path]);
      }
      const { error } = await svc.from("boveda_entradas").delete().eq("id", entrada_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (accion === "revelar" || accion === "mostrar_semilla") {
      const { entrada_id } = body;
      if (!entrada_id) return json({ ok: false, error: "Falta la entrada." }, 400);
      const { data: fila, error } = await svc.from("boveda_entradas").select("valor_cifrado, valor_iv, nombre").eq("id", entrada_id).maybeSingle();
      if (error) throw error;
      if (!fila?.valor_cifrado || !fila?.valor_iv) return json({ ok: false, error: "No hay valor guardado." }, 404);
      const valor = await descifrarTexto(await masterKey(), fromHexBytea(fila.valor_cifrado), fromHexBytea(fila.valor_iv), entrada_id);
      await auditar(accion, entrada_id, fila.nombre);
      return json({ ok: true, valor, visible_segundos: VALOR_VISIBLE_SEG });
    }

    if (accion === "codigo_2fa") {
      const { entrada_id } = body;
      if (!entrada_id) return json({ ok: false, error: "Falta la entrada." }, 400);
      const { data: fila, error } = await svc.from("boveda_entradas").select("valor_cifrado, valor_iv, nombre, tipo").eq("id", entrada_id).maybeSingle();
      if (error) throw error;
      if (fila?.tipo !== "2fa") return json({ ok: false, error: "Esta entrada no es un código 2FA." }, 400);
      if (!fila.valor_cifrado || !fila.valor_iv) return json({ ok: false, error: "Sin semilla guardada." }, 404);
      const semilla = await descifrarTexto(await masterKey(), fromHexBytea(fila.valor_cifrado), fromHexBytea(fila.valor_iv), entrada_id);
      const { codigo, segundosRestantes } = await totpCodigo(semilla);
      await auditar("codigo_2fa", entrada_id, fila.nombre);
      return json({ ok: true, codigo, segundos_restantes: segundosRestantes });
    }

    if (accion === "copiar_evento") {
      const { entrada_id } = body;
      await auditar("copiar", entrada_id ?? null);
      return json({ ok: true });
    }

    if (accion === "archivo_subir") {
      const { nombre, archivo_nombre, mime, contenido_base64, etiquetas, notas } = body;
      if (!nombre || !contenido_base64) return json({ ok: false, error: "Faltan datos del archivo." }, 400);
      const bytes = Uint8Array.from(atob(contenido_base64), (c) => c.charCodeAt(0));
      if (bytes.length > 1_048_576) return json({ ok: false, error: "El archivo supera 1 MB." }, 400);
      const id = crypto.randomUUID();
      const { cifrado, iv } = await cifrarBytes(await masterKey(), bytes, id);
      const path = `${id}/${archivo_nombre ?? "archivo"}`;
      const { error: upErr } = await svc.storage.from("boveda-archivos").upload(path, cifrado, {
        contentType: "application/octet-stream", upsert: false,
      });
      if (upErr) throw upErr;
      const { error } = await svc.from("boveda_entradas").insert({
        id, tipo: "archivo", nombre, archivo_path: path, archivo_nombre: archivo_nombre ?? null,
        valor_iv: toHexBytea(iv), etiquetas: etiquetas ?? [], notas: notas ?? null, creado_por: userId,
        mime: mime ?? null,
      });
      if (error) throw error;
      await auditar("crear", id, nombre);
      return json({ ok: true, id });
    }

    if (accion === "archivo_descargar") {
      const { entrada_id } = body;
      const { data: fila, error } = await svc.from("boveda_entradas").select("archivo_path, valor_iv, archivo_nombre, nombre").eq("id", entrada_id).maybeSingle();
      if (error) throw error;
      if (!fila?.archivo_path || !fila.valor_iv) return json({ ok: false, error: "Archivo no encontrado." }, 404);
      const { data: descarga, error: dlErr } = await svc.storage.from("boveda-archivos").download(fila.archivo_path);
      if (dlErr) throw dlErr;
      const cifrado = new Uint8Array(await descarga.arrayBuffer());
      const bytes = await descifrarBytes(await masterKey(), cifrado, fromHexBytea(fila.valor_iv), entrada_id);
      let binario = "";
      for (const b of bytes) binario += String.fromCharCode(b);
      await auditar("revelar", entrada_id, fila.nombre);
      return json({ ok: true, contenido_base64: btoa(binario), archivo_nombre: fila.archivo_nombre, visible_segundos: VALOR_VISIBLE_SEG });
    }

    return json({ ok: false, error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("boveda edge error:", e instanceof Error ? e.message : JSON.stringify(e));
    return json({ ok: false, error: "No se pudo completar la operación." }, 500);
  }
});
