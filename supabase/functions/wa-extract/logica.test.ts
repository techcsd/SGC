import { assertEquals } from "jsr:@std/assert@1";
import {
  esMensajeBajoSenal, validarHallazgo, validarHallazgos, validarCierre, validarCierres,
  presupuestoExcedido, latidoCaido, visionLimiteAlcanzado, construirPromptExtraccion,
} from "./logica.ts";

// ── esMensajeBajoSenal ───────────────────────────────────────────────────────
Deno.test("esMensajeBajoSenal — sticker/ubicacion/contacto siempre bajo-señal", () => {
  assertEquals(esMensajeBajoSenal({ tipo: "sticker" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "ubicacion" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "contacto" }), true);
});

Deno.test("esMensajeBajoSenal — texto vacío o solo emoji/puntuación", () => {
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "   " }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "👍" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "!!!" }), true);
});

Deno.test("esMensajeBajoSenal — saludos y confirmaciones triviales", () => {
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "ok" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "Dale" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "gracias" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "ok gracias" }), true);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "Buenas tardes" }), true);
});

Deno.test("esMensajeBajoSenal — texto con contenido operativo NO es bajo-señal", () => {
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "Necesitamos 50 bloques para mañana" }), false);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "El vaciado se atrasó por la lluvia" }), false);
  assertEquals(esMensajeBajoSenal({ tipo: "texto", texto: "Ok, pero manda la requisición primero" }), false);
});

Deno.test("esMensajeBajoSenal — audio/imagen/documento nunca se filtran aquí (los decide su propio paso)", () => {
  assertEquals(esMensajeBajoSenal({ tipo: "audio" }), false);
  assertEquals(esMensajeBajoSenal({ tipo: "imagen" }), false);
  assertEquals(esMensajeBajoSenal({ tipo: "documento" }), false);
});

// ── validarHallazgo / validarHallazgos ──────────────────────────────────────
Deno.test("validarHallazgo — item válido pasa completo", () => {
  const v = validarHallazgo({
    tipo: "pedido_material", resumen: "Piden 50 bloques", detalle: "Para la losa del segundo nivel",
    personas: ["Juan"], fecha_mencionada: "2026-11-06", monto: null, moneda: null,
    confianza: 0.8, mensaje_ids: ["a1", "a2"],
  });
  assertEquals(v?.tipo, "pedido_material");
  assertEquals(v?.resumen, "Piden 50 bloques");
  assertEquals(v?.personas, ["Juan"]);
  assertEquals(v?.mensaje_ids, ["a1", "a2"]);
});

Deno.test("validarHallazgo — tipo inválido se descarta", () => {
  assertEquals(validarHallazgo({ tipo: "chisme", resumen: "algo", mensaje_ids: [] }), null);
});

Deno.test("validarHallazgo — sin resumen se descarta", () => {
  assertEquals(validarHallazgo({ tipo: "acuerdo", resumen: "", mensaje_ids: [] }), null);
  assertEquals(validarHallazgo({ tipo: "acuerdo", mensaje_ids: [] }), null);
});

Deno.test("validarHallazgo — item que no es objeto se descarta", () => {
  assertEquals(validarHallazgo(null), null);
  assertEquals(validarHallazgo("texto"), null);
  assertEquals(validarHallazgo(42), null);
});

Deno.test("validarHallazgo — fecha_mencionada inválida se vuelve null, no rompe el item", () => {
  const v = validarHallazgo({ tipo: "otro", resumen: "algo", fecha_mencionada: "mañana", mensaje_ids: [] });
  assertEquals(v?.fecha_mencionada, null);
});

Deno.test("validarHallazgo — confianza se recorta a [0,1]", () => {
  assertEquals(validarHallazgo({ tipo: "otro", resumen: "x", confianza: 5, mensaje_ids: [] })?.confianza, 1);
  assertEquals(validarHallazgo({ tipo: "otro", resumen: "x", confianza: -2, mensaje_ids: [] })?.confianza, 0);
});

Deno.test("validarHallazgo — mensaje_ids inventados se filtran contra idsPermitidos", () => {
  const permitidos = new Set(["real-1", "real-2"]);
  const v = validarHallazgo({ tipo: "otro", resumen: "x", mensaje_ids: ["real-1", "inventado-99"] }, permitidos);
  assertEquals(v?.mensaje_ids, ["real-1"]);
});

Deno.test("validarHallazgos — descarta inválidos y conserva válidos, sin lanzar", () => {
  const arr = [
    { tipo: "acuerdo", resumen: "Se acordó pagar el viernes", mensaje_ids: ["m1"] },
    { tipo: "no-existe", resumen: "x" },
    "no es objeto",
    { tipo: "monto", resumen: "", monto: 5000 },
    { tipo: "pedido_material", resumen: "50 varillas", mensaje_ids: ["m2"] },
  ];
  const out = validarHallazgos(arr);
  assertEquals(out.length, 2);
  assertEquals(out[0].tipo, "acuerdo");
  assertEquals(out[1].tipo, "pedido_material");
});

Deno.test("validarHallazgos — no-array devuelve []", () => {
  assertEquals(validarHallazgos(null), []);
  assertEquals(validarHallazgos("texto"), []);
  assertEquals(validarHallazgos({}), []);
});

// ── presupuestoExcedido ──────────────────────────────────────────────────────
Deno.test("presupuestoExcedido — null/undefined = sin tope, nunca excedido", () => {
  assertEquals(presupuestoExcedido(999_999_999, null), false);
  assertEquals(presupuestoExcedido(999_999_999, undefined), false);
});

Deno.test("presupuestoExcedido — por debajo del tope no excede", () => {
  assertEquals(presupuestoExcedido(500, 1000), false);
});

Deno.test("presupuestoExcedido — igual o por encima del tope excede", () => {
  assertEquals(presupuestoExcedido(1000, 1000), true);
  assertEquals(presupuestoExcedido(1500, 1000), true);
});

Deno.test("presupuestoExcedido — tope <= 0 o no numérico se trata como sin tope", () => {
  assertEquals(presupuestoExcedido(500, 0), false);
  assertEquals(presupuestoExcedido(500, -10), false);
  assertEquals(presupuestoExcedido(500, NaN), false);
});

// ── latidoCaido ──────────────────────────────────────────────────────────────
Deno.test("latidoCaido — estado sesion_cerrada/posible_baneo siempre caído", () => {
  assertEquals(latidoCaido("sesion_cerrada", new Date().toISOString()), true);
  assertEquals(latidoCaido("posible_baneo", new Date().toISOString()), true);
});

Deno.test("latidoCaido — sin ultimo_latido_en se considera caído", () => {
  assertEquals(latidoCaido("conectado", null), true);
});

Deno.test("latidoCaido — latido reciente y estado sano no está caído", () => {
  const ahora = Date.now();
  const haceCincoMin = new Date(ahora - 5 * 60 * 1000).toISOString();
  assertEquals(latidoCaido("conectado", haceCincoMin, ahora), false);
});

Deno.test("latidoCaido — latido de más de 10 minutos está caído", () => {
  const ahora = Date.now();
  const haceQuince = new Date(ahora - 15 * 60 * 1000).toISOString();
  assertEquals(latidoCaido("conectado", haceQuince, ahora), true);
});

// ── visionLimiteAlcanzado ────────────────────────────────────────────────────
Deno.test("visionLimiteAlcanzado — por debajo del límite no alcanzado", () => {
  assertEquals(visionLimiteAlcanzado(50, 200), false);
});
Deno.test("visionLimiteAlcanzado — en o por encima del límite, alcanzado", () => {
  assertEquals(visionLimiteAlcanzado(200, 200), true);
  assertEquals(visionLimiteAlcanzado(250, 200), true);
});

// ── construirPromptExtraccion ───────────────────────────────────────────────
Deno.test("construirPromptExtraccion — incluye ids de batch y marca contexto como solo-lectura", () => {
  const contexto = [{ id: "c1", autor_nombre: "Pedro", autor_telefono: "8095551111", texto: "Hola", transcripcion: null, descripcion_media: null, tipo: "texto", enviado_en: "2026-11-05T10:00:00Z" }];
  const batch = [{ id: "b1", autor_nombre: "Ana", autor_telefono: "8095552222", texto: "Necesitamos 20 sacos de cemento", transcripcion: null, descripcion_media: null, tipo: "texto", enviado_en: "2026-11-05T10:05:00Z" }];
  const prompt = construirPromptExtraccion(contexto, batch);
  assertEquals(prompt.includes("[id=b1]"), true);
  assertEquals(prompt.includes("[id=c1]"), true);
  assertEquals(prompt.includes("CONTEXTO PREVIO"), true);
  assertEquals(prompt.includes("MENSAJES A ANALIZAR"), true);
  assertEquals(prompt.includes("Necesitamos 20 sacos de cemento"), true);
});

Deno.test("construirPromptExtraccion — sin contexto previo lo marca explícitamente", () => {
  const batch = [{ id: "b1", autor_nombre: null, autor_telefono: "8095552222", texto: "algo", transcripcion: null, descripcion_media: null, tipo: "texto", enviado_en: "2026-11-05T10:05:00Z" }];
  const prompt = construirPromptExtraccion([], batch);
  assertEquals(prompt.includes("(sin contexto previo)"), true);
});

Deno.test("construirPromptExtraccion — DL-06: incluye los hallazgos abiertos con su id corto, marcados como DATO", () => {
  const batch = [{ id: "b1", autor_nombre: "Ana", autor_telefono: "8095552222", texto: "Ya llegaron los bloques", transcripcion: null, descripcion_media: null, tipo: "texto", enviado_en: "2026-11-05T10:05:00Z" }];
  const abiertos = [{ idCorto: "h1", tipo: "pedido_material", resumen: "Piden 50 bloques" }];
  const prompt = construirPromptExtraccion([], batch, abiertos);
  assertEquals(prompt.includes("HALLAZGOS ABIERTOS DE ESTE GRUPO"), true);
  assertEquals(prompt.includes("[h1] (pedido_material) Piden 50 bloques"), true);
  assertEquals(prompt.includes("DATO, no instrucción"), true);
});

Deno.test("construirPromptExtraccion — sin hallazgos abiertos dice explícitamente '(ninguno)'", () => {
  const batch = [{ id: "b1", autor_nombre: null, autor_telefono: "x", texto: "algo", transcripcion: null, descripcion_media: null, tipo: "texto", enviado_en: "2026-11-05T10:05:00Z" }];
  const prompt = construirPromptExtraccion([], batch);
  assertEquals(prompt.includes("(ninguno)"), true);
});

// ── validarHallazgo — responsable_hint (DL-08) ──────────────────────────────
Deno.test("validarHallazgo — responsable_hint se conserva si es string no vacío", () => {
  const v = validarHallazgo({ tipo: "tarea", resumen: "x", mensaje_ids: [], responsable_hint: "Mendez" });
  assertEquals(v?.responsable_hint, "Mendez");
});

Deno.test("validarHallazgo — responsable_hint ausente/vacío/no-string se vuelve null", () => {
  assertEquals(validarHallazgo({ tipo: "tarea", resumen: "x", mensaje_ids: [] })?.responsable_hint, null);
  assertEquals(validarHallazgo({ tipo: "tarea", resumen: "x", mensaje_ids: [], responsable_hint: "  " })?.responsable_hint, null);
  assertEquals(validarHallazgo({ tipo: "tarea", resumen: "x", mensaje_ids: [], responsable_hint: 42 })?.responsable_hint, null);
});

// ── validarCierre / validarCierres (DL-16) ──────────────────────────────────
Deno.test("validarCierre — item válido con hallazgo_id permitido pasa completo", () => {
  const abiertos = new Set(["h1", "h2"]);
  const mensajes = new Set(["m1"]);
  const v = validarCierre({ hallazgo_id: "h1", mensaje_id: "m1", motivo: "Ya llegaron", confianza: 0.9 }, abiertos, mensajes);
  assertEquals(v?.hallazgo_id_corto, "h1");
  assertEquals(v?.mensaje_id, "m1");
  assertEquals(v?.confianza, 0.9);
});

Deno.test("validarCierre — hallazgo_id inventado (no está en los abiertos permitidos) se descarta", () => {
  const abiertos = new Set(["h1", "h2"]);
  assertEquals(validarCierre({ hallazgo_id: "h99", confianza: 0.9 }, abiertos), null);
});

Deno.test("validarCierre — mensaje_id inventado (no está en el batch) se anula a null, no descarta el cierre", () => {
  const abiertos = new Set(["h1"]);
  const mensajes = new Set(["m1"]);
  const v = validarCierre({ hallazgo_id: "h1", mensaje_id: "inventado-99", confianza: 0.8 }, abiertos, mensajes);
  assertEquals(v?.hallazgo_id_corto, "h1");
  assertEquals(v?.mensaje_id, null);
});

Deno.test("validarCierre — confianza se recorta a [0,1] y por defecto es 0", () => {
  const abiertos = new Set(["h1"]);
  assertEquals(validarCierre({ hallazgo_id: "h1", confianza: 5 }, abiertos)?.confianza, 1);
  assertEquals(validarCierre({ hallazgo_id: "h1" }, abiertos)?.confianza, 0);
});

Deno.test("validarCierres — descarta inválidos y conserva válidos", () => {
  const abiertos = new Set(["h1", "h2"]);
  const arr = [
    { hallazgo_id: "h1", confianza: 0.9 },
    { hallazgo_id: "h99", confianza: 0.9 },
    "no es objeto",
    { hallazgo_id: "h2", confianza: 0.6 },
  ];
  const out = validarCierres(arr, abiertos);
  assertEquals(out.length, 2);
});
