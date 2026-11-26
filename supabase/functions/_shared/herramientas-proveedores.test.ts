// EA1 — herramientas del conector para proveedores de tecnología (solo lectura, canal MCP).
import { assertEquals } from "jsr:@std/assert@1";
import { TOOLS, toolsParaUsuario } from "./herramientas.ts";

const base = { usuario_id: "u", nombre: "n", es_admin: false, roles: [] as string[] };
// deno-lint-ignore no-explicit-any
const nombres = (cap: any) => toolsParaUsuario({ ...base, ...cap }, "mcp").map((t) => t.name);
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;

Deno.test("EA1: las 2 tools existen, son de lectura (sin write) y solo MCP", () => {
  for (const n of ["listar_proveedores_tecnologia", "detalle_proveedor_tecnologia"]) {
    const t = tool(n);
    assertEquals(t !== undefined, true, n);
    assertEquals(t.write, undefined, `${n} no debe escribir`);
    assertEquals(t.canales, ["mcp"]);
    assertEquals(typeof t.rpc, "string");
  }
});

Deno.test("EA1: visibilidad — tecnología, admin y permiso granular (Compras=ver) sí; otros módulos no", () => {
  assertEquals(nombres({ modulos: ["tecnologia"] }).includes("listar_proveedores_tecnologia"), true);
  assertEquals(nombres({ modulos: [], es_admin: true }).includes("detalle_proveedor_tecnologia"), true);
  assertEquals(
    nombres({ modulos: ["compras"], permisos: { "tecnologia.proveedores": "ver" } }).includes("listar_proveedores_tecnologia"),
    true,
  );
  // Compras sin el permiso granular: NO se ofrece (el RPC además lo negaría con 42501).
  assertEquals(nombres({ modulos: ["compras"] }).includes("listar_proveedores_tecnologia"), false);
  assertEquals(nombres({ modulos: ["bitacora"] }).includes("detalle_proveedor_tecnologia"), false);
});

Deno.test("EA1: ningún canal Compa la ofrece todavía", () => {
  const compa = toolsParaUsuario({ ...base, modulos: ["tecnologia"], es_admin: true }, "compa").map((t) => t.name);
  assertEquals(compa.includes("listar_proveedores_tecnologia"), false);
});

Deno.test("EA1: map del listado — recorta el texto y manda null si no hay", () => {
  const t = tool("listar_proveedores_tecnologia");
  assertEquals(t.map!({}), { p_q: null, p_incluir_inactivos: false });
  assertEquals(t.map!({ buscar: "cerradura", incluir_inactivos: true }), { p_q: "cerradura", p_incluir_inactivos: true });
  assertEquals((t.map!({ buscar: "x".repeat(500) }).p_q as string).length, 120);
});

Deno.test("EA1: el detalle pasa el id tal cual al RPC (y nunca pide archivos)", () => {
  const t = tool("detalle_proveedor_tecnologia");
  assertEquals(t.rpc, "tec_proveedor_detalle_asistente");
  assertEquals(t.map!({ id: "abc" }), { p_id: "abc" });
  assertEquals(JSON.stringify(t.input_schema).includes("archivo"), false);
});
