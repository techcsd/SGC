import { assert, assertEquals } from "jsr:@std/assert@1";
import { faltantesEnDev, filaParaDev, mismaBase, parcheParaProd, type TareaFila } from "./agente-ingeniero-espejo-lib.ts";

const base: TareaFila = {
  id: "11111111-1111-1111-1111-111111111111", origen: "reporte_usuario", origen_ref: "r1", clasificacion: "bug",
  titulo: "No sale combustible", texto_origen: "texto", severidad: "media", estado: "nueva", repo: "sgc", modulo: "flota",
  reporte_id: "rep-prod", aprobacion_id: "apr-prod", pr_url: "https://x",
};

Deno.test("filaParaDev: mismo id, estado nueva y sin referencias a tablas de prod", () => {
  const f = filaParaDev({ ...base, estado: "analizando" });
  assertEquals(f.id, base.id);
  assertEquals(f.estado, "nueva");
  assertEquals(f.reporte_id, null);
  assert(!("aprobacion_id" in f) && !("pr_url" in f));
});

Deno.test("parcheParaProd: solo cambios en campos permitidos; nunca aprobacion_id/reporte_id", () => {
  const dev = { estado: "en_revision", pr_url: "https://github.com/a/b/pull/1", pr_numero: 1, aprobacion_id: "apr-dev", reporte_id: "x", costo_ia: 0.1 };
  const prod = { estado: "nueva", pr_url: null, pr_numero: null, costo_ia: 0.1 };
  assertEquals(parcheParaProd(dev, prod), { estado: "en_revision", pr_url: "https://github.com/a/b/pull/1", pr_numero: 1 });
  assertEquals(parcheParaProd(prod, prod), {});
});

Deno.test("parcheParaProd: compara jsonb por valor", () => {
  assertEquals(parcheParaProd({ veredictos: { a: 1 } }, { veredictos: { a: 1 } }), {});
  assertEquals(parcheParaProd({ veredictos: { a: 2 } }, { veredictos: { a: 1 } }), { veredictos: { a: 2 } });
});

Deno.test("faltantesEnDev y mismaBase", () => {
  assertEquals(faltantesEnDev(["a", "b", "c"], new Set(["b"])), ["a", "c"]);
  assert(mismaBase("https://x.supabase.co/", "https://X.supabase.co"));
  assert(!mismaBase("https://x.supabase.co", "https://y.supabase.co"));
});
