// supabase/functions/admin-fin-impersonacion/index.test.ts — DN-18 (ronda DN)
// — ver admin-entrar-como/index.test.ts para el patrón de fábricas inyectadas.
//
//   deno test --allow-env --no-check supabase/functions/admin-fin-impersonacion
import { assertEquals } from "jsr:@std/assert@1";
import { manejar } from "./index.ts";

Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "fake-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key");

function req(body?: unknown, headers: Record<string, string> = { Authorization: "Bearer x" }) {
  return new Request("https://fake.supabase.co/admin-fin-impersonacion", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fakeAnon(opts: { getUserError?: boolean; oauthError?: { code: string } | null; isAdmin?: boolean }) {
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

function fakeAdmin() {
  return () => ({
    from: (tabla: string) => {
      if (tabla === "audit_log") {
        return { insert: () => ({ then: (res: () => void) => { res(); return Promise.resolve(); } }) };
      }
      throw new Error(`from() no simulado: ${tabla}`);
    },
    auth: {
      admin: {
        updateUserById: () => ({ then: (res: () => void) => { res(); return Promise.resolve(); } }),
      },
    },
  });
}

function fabricas(anonOpts: Parameters<typeof fakeAnon>[0]) {
  return { crearAnon: fakeAnon(anonOpts), crearAdmin: fakeAdmin() };
}

Deno.test("401 — sin header Authorization", async () => {
  const res = await manejar(req({ userId: "u1" }, {}));
  assertEquals(res.status, 401);
});

Deno.test("401 — sesión inválida", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ getUserError: true }));
  assertEquals(res.status, 401);
});

Deno.test("403 — token OAuth (Claude) rechazado", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ oauthError: { code: "42501" } }));
  assertEquals(res.status, 403);
});

Deno.test("403 — el que llama no es admin", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({ isAdmin: false }));
  assertEquals(res.status, 403);
});

Deno.test("400 — falta userId", async () => {
  const res = await manejar(req({}), fabricas({}));
  assertEquals(res.status, 400);
});

Deno.test("200 — fin de impersonación OK", async () => {
  const res = await manejar(req({ userId: "u1" }), fabricas({}));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
});
