// supabase/functions/admin-entrar-como/index.test.ts — DN-18 (ronda DN) —
// cubre el handler HTTP (401/403/400/200) con clientes Supabase fabricados a
// mano (sin red), inyectados vía el parámetro `fabricas` de `manejar()`.
// Mismo patrón para admin-fin-impersonacion/index.test.ts.
//
//   deno test --allow-env --no-check supabase/functions/admin-entrar-como
import { assertEquals } from "jsr:@std/assert@1";
import { manejar } from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "fake-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key");

function req(body?: unknown, headers: Record<string, string> = { Authorization: "Bearer x" }) {
  return new Request("https://fake.supabase.co/admin-entrar-como", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Fabrica del cliente "caller" (anon + Authorization del que llama).
function fakeAnon(opts: {
  getUserError?: boolean;
  oauthError?: { code: string } | null;
  isAdmin?: boolean;
}) {
  return () => ({
    auth: {
      getUser: async () =>
        opts.getUserError
          ? { data: { user: null }, error: new Error("invalido") }
          : { data: { user: { id: "caller-1" } }, error: null },
    },
    schema: (_s: string) => ({
      rpc: async (fn: string) => {
        if (fn === "rechazar_si_cliente_oauth") {
          return opts.oauthError === undefined ? { error: null } : { error: opts.oauthError };
        }
        if (fn === "is_admin") return { data: opts.isAdmin ?? true, error: null };
        throw new Error(`rpc no simulado: ${fn}`);
      },
    }),
  });
}

// Fabrica del cliente admin (service role).
function fakeAdmin(opts: {
  target?: { id: string; email: string | null; nombre?: string; activo?: boolean } | null;
  targetEsAdmin?: boolean;
  generateLinkError?: boolean;
}) {
  return () => ({
    from: (tabla: string) => {
      if (tabla === "usuarios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.target ?? null, error: null }),
            }),
          }),
        };
      }
      if (tabla === "usuarios_roles") {
        return {
          select: () => ({
            eq: async () => ({
              data: opts.targetEsAdmin ? [{ rol: { codigo: "admin" } }] : [],
              error: null,
            }),
          }),
        };
      }
      if (tabla === "audit_log") {
        return { insert: () => ({ then: (res: () => void) => { res(); return Promise.resolve(); } }) };
      }
      throw new Error(`from() no simulado: ${tabla}`);
    },
    auth: {
      admin: {
        updateUserById: () => ({ then: (res: () => void) => { res(); return Promise.resolve(); } }),
        generateLink: async () =>
          opts.generateLinkError
            ? { data: null, error: new Error("no se pudo") }
            : { data: { properties: { hashed_token: "th_123" } }, error: null },
      },
    },
  });
}

function fabricas(anonOpts: Parameters<typeof fakeAnon>[0], adminOpts: Parameters<typeof fakeAdmin>[0]) {
  return { crearAnon: fakeAnon(anonOpts), crearAdmin: fakeAdmin(adminOpts) };
}

Deno.test("401 — sin header Authorization", async () => {
  const res = await manejar(req({ userId: "u1" }, {}));
  assertEquals(res.status, 401);
});

Deno.test("401 — sesión inválida (getUser falla)", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ getUserError: true }, {}));
  assertEquals(res.status, 401);
});

Deno.test("403 — token OAuth (Claude) rechazado", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ oauthError: { code: "42501" } }, {}));
  assertEquals(res.status, 403);
});

Deno.test("403 — el que llama no es admin", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ isAdmin: false }, {}));
  assertEquals(res.status, 403);
});

Deno.test("400 — falta userId", async () => {
  const res = await manejar(req({}), fabricas({}, {}));
  assertEquals(res.status, 400);
});

Deno.test("400 — userId es el mismo que el que llama", async () => {
  const res = await manejar(req({ userId: "caller-1" }), fabricas({}, {}));
  assertEquals(res.status, 400);
});

Deno.test("404 — usuario objetivo no existe", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({}, { target: null }));
  assertEquals(res.status, 404);
});

Deno.test("403 — no se puede impersonar a otro admin", async () => {
  const res = await manejar(
    req({ userId: "u1" }),
    fabricas({}, { target: { id: "u1", email: "a@b.com" }, targetEsAdmin: true }),
  );
  assertEquals(res.status, 403);
});

Deno.test("200 — impersonación OK", async () => {
  const res = await manejar(
    req({ userId: "u1" }),
    fabricas({}, { target: { id: "u1", email: "a@b.com", nombre: "A" }, targetEsAdmin: false }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.token_hash, "th_123");
});
