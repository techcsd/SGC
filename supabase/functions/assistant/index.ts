import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import * as XLSX from "npm:xlsx@0.18.5";
// CR1 (FASE 1) — registro de herramientas compartido con el servidor MCP
// (supabase/functions/mcp). Ver _shared/herramientas.ts: mismo TOOLS, mismo
// toolsParaUsuario, mismo claveIdem — Compa no cambia de comportamiento.
import {
  type Cap, type ToolDef, TOOLS, toolsParaUsuario, claveIdem, idemUuid, ejecutarHerramientaLectura,
} from "../_shared/herramientas.ts";

// ============================================================================
// AW4 — Asistente de IA "Compa".
//   v1: consultas (solo lectura).
//   v2: acciones con CONFIRMACIÓN — crear tarea, requisición o conduce. El
//       asistente PREPARA un borrador (herramientas 'proponer_*'); el usuario
//       confirma con un botón; recién ahí la edge function ejecuta la MISMA RPC
//       del flujo normal, con sus mismas validaciones (un solo camino, AU1).
//
// Las herramientas ejecutan con el JWT del usuario → RLS aplica: Compa hereda
// los permisos de quien le habla. Nunca service role para datos de negocio.
//
// Secrets: ANTHROPIC_API_KEY (obligatorio) · ASSISTANT_MODEL (opcional).
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// CP3/CP9 — Haiku (el modelo más chico) con 46+ herramientas y reglas largas
// producía errores de razonamiento (decir "no tengo herramienta" sin revisar su
// lista, prometer una acción y no llamarla). Sonnet vigente por defecto; Haiku
// se puede volver a fijar por secreto si algún día hay una tarea interna barata
// que lo use, pero YA NO es el default de este asistente de cara al usuario.
const MODEL = Deno.env.get("ASSISTANT_MODEL") ?? "claude-sonnet-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// BJ2 — secreto compartido con el puente n8n (WhatsApp). Si no está seteado, el
// modo WhatsApp queda apagado y la edge solo responde con sesión de usuario.
const WHATSAPP_ASSISTANT_SECRET = Deno.env.get("WHATSAPP_ASSISTANT_SECRET");

const MAX_MSGS_HORA = 60;
const MAX_TOOL_LOOPS = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // CR1 (FASE 4) — hallazgo real: x-sgc-client (CQ3, SupabaseService) faltaba
  // aquí, así que el preflight del navegador bloqueaba el POST real (reproducido
  // con un OPTIONS directo contra esta edge en dev). Se encontró construyendo
  // claude-borrador (mismo patrón de cabeceras) y se corrige aquí también.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sgc-client",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;

// AZ11 — trato del sector construcción por rol: "usted" con roles senior, tú con el resto.
function tratamientoDeRoles(roles: string[]): string {
  const has = (kw: string) => roles.some((r) => r.toLowerCase().includes(kw));
  if (has("ingenier")) return 'Es ingeniero/a: trátalo de "usted" y llámalo "Ing. <primer nombre>". El trato universal en obra dominicana.';
  if (has("abogado")) return 'Es abogado/a: trátalo de "usted" y llámalo "Lic. <apellido>".';
  if (has("direcci") || has("gerenc") || has("gerente"))
    return 'Es de dirección/gerencia: trátalo de "usted", con respeto (puedes usar "Don/Doña <nombre>" o "señor/a").';
  if (has("capataz")) return 'Es capataz/maestro de obra: tutéalo con respeto y puedes llamarlo "maestro" (el trato natural de obra).';
  if (has("chofer") || has("transport")) return "Es chofer/transportista: tutéalo con respeto, por su nombre.";
  return "Tutéalo, cercano y respetuoso, por su nombre.";
}

// AY-F1 (hallazgo 4) — Repara UTF-8 doble-codificado ("Â¿CuÃ¡ntos" → "¿Cuántos").
// El texto del usuario llegaba doble-codificado (Claude lo toleraba, pero se
// guardaba mojibake en título y mensajes). Se sanea EN LA ENTRADA, así el texto
// que ve Claude y el que se guarda quedan limpios. Solo actúa si (a) hay patrón
// de mojibake y (b) todos los chars caben en un byte (o sea, parece Latin-1
// mal-decodificado); si el redecode no es UTF-8 válido, se deja el original.
function fixMojibake(s: string): string {
  if (!s) return s;
  let suspicious = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xFF) return s;                 // hay multibyte real -> no tocar
    if ((c === 0xC2 || c === 0xC3) && i + 1 < s.length) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0x80 && n <= 0xBF) suspicious = true;  // C2/C3 + continuacion
    }
  }
  if (!suspicious) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return s; }
}

// BB4 — El prompt se parte en DOS bloques:
//  (A) INSTRUCCIONES_ESTATICAS: idéntico para todos → se cachea (prompt caching) y
//      da alto cache-hit sin mezclar identidades.
//  (B) bloqueIdentidad(): armado por request desde el JWT (nombre/rol/módulos) + la
//      fecha/hora actual. NUNCA se cachea → la identidad siempre es la del usuario real,
//      jamás heredada de otra sesión ni de un bloque compartido.
const INSTRUCCIONES_ESTATICAS = [
  "Eres Compa, el asistente interno de SGC (el ERP de Constructora SD, una constructora dominicana).",
  "Hablas español dominicano correcto, formal-cercano (ni acartonado ni corporativo): breve, directo y resolutivo, como un compañero que resuelve. El TRATO (tú/usted y el título) depende del rol del usuario — ver PERFIL en el bloque de identidad y respétalo siempre.",
  "",
  "QUÉ PUEDES HACER:",
  "- CONSULTAR información (herramientas de lectura). Todo dato/número que des DEBE salir de una herramienta; si no tienes una, dilo (\"eso todavía no lo puedo consultar\"). NUNCA inventes datos ni IDs.",
  "- PREPARAR acciones con las herramientas 'proponer_*' (tarea, requisición, conduce, ruta). NUNCA ejecutas directo: al llamar una 'proponer_*' el sistema le muestra al usuario una tarjeta para CONFIRMAR. Tú solo dile en una frase corta qué preparaste y pídele que confirme.",
  "- Si piden registrar/anotar una echada de combustible ('registra una echada', 'eché gasolina/diésel'): pregunta lo que falte (vehículo —resuélvelo con 'listar_vehiculos'—, galones, monto) y llama 'preparar_echada'. Esta NO crea nada: abre el formulario real de Combustible con esos datos puestos; las fotos del recibo y el tablero, y el odómetro si no lo diste, los completa la persona ahí. NUNCA digas que la echada quedó registrada — solo que la dejaste preparada.",
  "- GENERAR archivos (PDF/Excel) con 'generar_reporte_pdf' — aparecen como tarjeta descargable.",
  "- Explicar CÓMO funciona el sistema con 'buscar_ayuda' (usa esto para preguntas de uso, no de datos).",
  "- RECORDAR preferencias del usuario con 'recordar' (obra por defecto, formato, etc.).",
  "- Ver la ACTIVIDAD del día de una persona con 'actividad_de_usuario' (la tuya siempre; la de otro solo si tu rol te lo permite — la herramienta lo controla).",
  "- Ver las RUTAS del día con 'rutas_del_dia' (todas si eres logística/jefe de flota/gerencia/admin; si no, las tuyas).",
  "- Decir DÓNDE hay existencia de un artículo con 'disponibilidad_de_articulo' (resuelve apodos; muestra solo los almacenes que tu rol ve).",
  "- Si tienes disponible la herramienta de búsqueda en internet (web search), úsala SOLO para información pública del mundo real que NO está en el sistema (precios de mercado, normativas, clima, un dato general) — nunca como sustituto de una herramienta del sistema. Cuando la uses, CITA la fuente (nombre del sitio o URL) en tu respuesta; no la des como si fuera un dato del ERP.",
  "",
  "REGLAS DURAS:",
  "1. Para preparar una acción primero RESUELVE los IDs con las herramientas de lectura (mis_proyectos para la obra, buscar_articulos para cada ítem, listar_almacenes para el almacén, despachantes_disponibles, buscar_usuarios). Jamás inventes un ID.",
  "2. Si te falta un dato para la acción (obra, ítems, cantidades), PREGUNTA antes de preparar. No asumas.",
  "3. Heredas los permisos del usuario. Si una herramienta falla por permisos, di \"no tengo acceso a eso\" sin tecnicismos.",
  "4. Resume los resultados en lenguaje claro; no vuelques JSON. Si no hay resultados, dilo.",
  "5. Nunca digas que una acción \"ya está hecha\" solo por prepararla: el mensaje correcto es \"Borrador preparado — confírmalo en la tarjeta\", NO \"ya lo creé\". Solo tras la confirmación existe el documento.",
  "",
  "DESAMBIGUACIÓN (BB1) — no marees al usuario preguntando de más:",
  "9. Las herramientas de búsqueda devuelven candidatos ordenados por relevancia (con 'score'). Si el usuario dio un calificativo que distingue claramente a UNO (p. ej. dijo 'central' y hay 'Bodega Central'), ASÚMELO y anúncialo (\"Asumo Bodega Central — dime si era otro\"). Pregunta SOLO cuando dos o más candidatos encajan igual de bien; ahí sí, ofrece las opciones.",
  "",
  "IDEMPOTENCIA (BB3) — un pedido, un documento:",
  "10. No prepares dos veces la misma acción. Si ya preparaste un movimiento y el usuario insiste o repite, es el MISMO borrador (el sistema lo deduplica): dile \"ya hay un borrador de este movimiento, confírmalo en la tarjeta\", no generes otro. Confirmar dos veces produce UN solo documento.",
  "",
  "DATOS DE PRUEBA (BB3) — transparencia antes de confirmar:",
  "11. Si la obra, el almacén o el usuario involucrado es de PRUEBA, el documento saldrá marcado como de prueba. Avísalo ANTES de que confirme (\"ojo: esa obra es de prueba, este conduce saldrá de prueba; para uno real usa una obra real\"). No lo escondas.",
  "",
  "HONESTIDAD SOBRE LO QUE SABES (crítico):",
  "6. Distingue SIEMPRE dos fuentes: (a) tu PERFIL — el nombre, el rol/trato, si eres admin y los módulos del bloque de identidad; es un dato que te dieron al iniciar, NO lo consultaste; (b) una CONSULTA — lo que acabas de leer llamando una herramienta EN ESTE TURNO. Al hablar de datos, deja claro cuál es cuál (\"según tu perfil…\" vs \"acabo de consultar y…\").",
  "7. PROHIBIDO decir que \"verificaste\", \"consulté\", \"confirmé con el sistema\", \"en vivo\" o \"ya lo revisé\" si NO llamaste una herramienta en este mismo turno. Si no la llamaste, no lo afirmes. Si de verdad quieres confirmar algo, llama la herramienta (usa 'quien_soy' para la identidad) y recién entonces dilo.",
  "8. Si no tienes una herramienta para algo, dilo con claridad (\"eso no lo puedo consultar todavía, no tengo herramienta\") en vez de deducirlo del perfil y hacerlo pasar por consulta.",
  "8b. Si no sabes qué herramienta usar, o el usuario pregunta por un área del SGC que no reconoces, llama 'que_puedo_consultar' PRIMERO: te dice, módulo por módulo, si esta persona tiene acceso y qué herramienta usar.",
  "",
  "NUNCA UNA EXCUSA VACÍA (BE2 — regla dura):",
  "12. PROHIBIDO responder \"No pude completar la consulta, intenta reformular\" o cualquier disculpa sin contenido. TODO fallo lleva CAUSA + SALIDA: di POR QUÉ falló y ofrece el SIGUIENTE PASO. Ejemplos: \"no encontré el artículo 'puntales' — ¿se llama distinto? puedo buscarlo por apodo\"; \"esa consulta de stock falló, ya la reporté a Tecnología — ¿quieres que intente otra cosa?\"; \"eso no lo puedo ver con tu acceso actual\".",
  "13. Si el usuario te pide algo para lo que NO tienes ninguna herramienta, PRIMERO llama 'reportar_gap' (para que Tecnología construya esa capacidad) y LUEGO dile con honestidad qué no puedes todavía y qué SÍ le ofreces. No inventes un rodeo para fingir que lo resolviste.",
  "14. Si una herramienta te devuelve un error o 'no tengo acceso', no lo escondas: explícale al usuario qué pasó en una frase (el sistema ya lo registró para Tecnología) y ofrécele una alternativa.",
].join("\n");

// CP3/CP9 — lista compacta de herramientas DISPONIBLES PARA ESTE USUARIO (una
// línea por herramienta: nombre + para qué). Va en el bloque de identidad (no
// se cachea, porque el set de tools cambia por usuario/módulos) junto con la
// regla de revisarla antes de decir "no puedo". Objetivo: el caso Hector (dijo
// "no tengo herramienta para listar almacenes" teniendo 'listar_almacenes').
function listaHerramientasCompacta(tools: ToolDef[]): string {
  const primeraFrase = (d: string) => {
    const corte = d.indexOf(". ");
    const f = corte > 0 && corte < 140 ? d.slice(0, corte + 1) : d.slice(0, 120);
    return f.trim();
  };
  return tools.filter((t) => !t.gap).map((t) => `- ${t.name}: ${primeraFrase(t.description)}`).join("\n");
}

function bloqueIdentidad(cap: Cap, ahoraRD: string, listaTools: string): string {
  return [
    "PERFIL (dato inicial de ESTA persona, NO es una consulta que hiciste):",
    `- Hablas con: ${cap.nombre}${cap.es_admin ? " (administrador)" : ""}.`,
    `- Rol(es): ${cap.roles.length ? cap.roles.join(", ") : "sin rol asignado"}.`,
    `- TRATO: ${tratamientoDeRoles(cap.roles)} Sé consistente con este trato en cada respuesta, saludos incluidos.`,
    `- Módulos con acceso: ${cap.modulos.length ? cap.modulos.join(", ") : "ninguno especial"}.`,
    `- Fecha y hora actual (República Dominicana): ${ahoraRD}.`,
    "Si dudas de con quién hablas o del día/hora, usa 'quien_soy' (no lo deduzcas del historial: puede venir de otra sesión).",
    "Cuando el usuario diga \"mis\", \"mi obra\", \"mi vehículo\", usa las herramientas 'mis_*'.",
    "",
    "TUS HERRAMIENTAS DISPONIBLES AHORA MISMO (revísala ANTES de decir que no puedes algo):",
    listaTools,
    "",
    "REGLA DURA (CP3/CP9 — caso real: dijiste 'no tengo herramienta para listar almacenes' teniendo 'listar_almacenes'):",
    "NUNCA digas que no puedes hacer algo sin revisar la lista de arriba primero — puede que SÍ la tengas con otro nombre.",
    "NUNCA anuncies una acción ('voy a generar…', 'procedo a…', 'en un momento te preparo…') que no vas a EJECUTAR con una herramienta en este MISMO turno — si lo dices, LLÁMALA ya; si no puedes, dilo directo sin anunciar nada primero.",
  ].join("\n");
}

// Fecha/hora actual en zona RD (para el bloque de identidad).
function ahoraRD(): string {
  try {
    return new Intl.DateTimeFormat("es-DO", {
      timeZone: "America/Santo_Domingo", dateStyle: "full", timeStyle: "short",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ") + " (UTC)";
  }
}

async function callClaude(system: Any, tools: Any, messages: Any, toolChoice?: Any) {
  const body: Any = { model: MODEL, max_tokens: 4000, system, tools, messages }; // CP3/CP9 — era 1400, cortaba respuestas largas
  if (toolChoice) body.tool_choice = toolChoice;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

// BB4(2) — Router de intención: si el mensaje pide DATOS del sistema o VERIFICAR algo,
// forzamos una tool en la primera llamada (tool_choice:any). El prefill forzado hace
// estructuralmente imposible responder "acabo de consultarlo" sin haber consultado.
const INTENCION_DATOS =
  /\b(mi rol|mis? roles?|mis? permisos?|tengo acceso|puedo (ver|entrar|acceder)|qui[eé]n soy|con qui[eé]n hablas|qu[eé] hora|qu[eé] d[ií]a|cu[aá]nto|cu[aá]ntos|cu[aá]ntas|mira|verifica|consulta|revisa|checa|chequea|mu[eé]strame|ens[eé][ñn]ame|lista|list[aá]me|dame|cu[aá]les son|mis? (obras?|proyectos?|conduces?|rutas?|tareas?|veh[ií]culos?)|stock|existencias?|disponibles?|d[oó]nde hay|en qu[eé] (almac[eé]n(es)?|bodegas?|obras?|proyectos?)|inventario de|desempe[ñn]o|combustible|mantenimiento|actividad|qu[eé] hizo|qu[eé] hice|rutas? (de |del )?(hoy|d[ií]a)|s[aá]came|saca|saques|quiero|necesito|crea|cr[eé]ame|asigna|as[ií]gna|prepara|prep[aá]rame|mueve|env[ií]a|solicita|requisici[oó]n|conduce|taladro)\b/i;
function fuerzaHerramienta(mensaje: string): boolean {
  return INTENCION_DATOS.test(mensaje);
}

// BB4(4) — El validador post-respuesta busca AFIRMACIONES DE VERIFICACIÓN ("consulté",
// "en vivo", "acabo de", "confirmé con el sistema", "ya lo revisé"…). Si aparecen y el
// turno NO tuvo ninguna tool call → es una mentira; se regenera o se antepone aviso.
const AFIRMA_VERIFICACION =
  /\b(acabo de (consultar|revisar|verificar|mirar|chequear)|consult[eé]|verifiqu[eé]|confirm[eé] con el sistema|en vivo|ya lo (revis[eé]|verifiqu[eé]|consult[eé])|reci[eé]n (consult|revis|verifi)|lo revis[eé] (ahora|en el sistema)|seg[uú]n (el sistema|la consulta que hice))\b/i;
function afirmaVerificacionSinTool(texto: string, huboTool: boolean): boolean {
  return !huboTool && AFIRMA_VERIFICACION.test(texto);
}

// CP3/CP9 — caso Hector: antes de aceptar un `reportar_gap`, se compara el tema
// contra las herramientas que el usuario SÍ tiene (nombre + descripción). Si
// alguna encaja, el gap es falso (razonamiento, no falta real) — se rechaza.
// Heurística simple y conservadora: requiere al menos una coincidencia fuerte
// con el NOMBRE de la tool, o dos con su descripción, para no sobre-rechazar.
const GAP_STOPWORDS = new Set([
  "para", "como", "poder", "tener", "hacer", "sobre", "desde", "hasta", "donde",
  "cuando", "quien", "algo", "alguna", "algun", "estas", "estos", "esos", "esas",
  "todo", "toda", "todos", "todas", "listar", "lista", "mostrar", "quiero", "necesito",
  // CP3/CP9 — hallazgo real: "usuario"/"usuarios" aparece en CASI toda descripción
  // de tool (genérico, no indica intención) y como substring de "uso" causaba
  // falsos positivos (vehiculos_en_uso, buscar_usuarios) que le ganaban al
  // match real por orden de aparición en el array. Fuera de la lista.
  "usuario", "usuarios", "consultar", "proxima", "próxima",
]);
// Solo cuenta coincidencia de NOMBRE si es la MISMA palabra o un plural/singular
// cercano (diferencia de longitud ≤2) — una subcadena arbitraria ("uso" dentro
// de "usuario") no cuenta; eso fue lo que rompió el match de Hector.
function tokenCoincide(nt: string, p: string): boolean {
  if (nt === p) return true;
  if (Math.abs(nt.length - p.length) > 2) return false;
  return nt.includes(p) || p.includes(nt);
}
function herramientaQueCoincide(tema: string, disponibles: ToolDef[]): ToolDef | null {
  const palabras = tema.toLowerCase().replace(/[^a-záéíóúñ0-9\s]/gi, " ").split(/\s+/)
    .filter((w) => w.length >= 5 && !GAP_STOPWORDS.has(w));
  if (!palabras.length) return null;
  let mejor: ToolDef | null = null;
  let mejorScore = 0;
  for (const t of disponibles) {
    if (t.gap) continue;
    const nombreTokens = t.name.toLowerCase().split("_");
    const desc = t.description.toLowerCase();
    let score = 0;
    for (const p of palabras) {
      if (nombreTokens.some((nt) => tokenCoincide(nt, p))) score += 2;
      else if (desc.includes(p)) score += 1;
    }
    if (score > mejorScore) { mejorScore = score; mejor = t; }
  }
  return mejorScore >= 2 ? mejor : null;
}

// CP3/CP9 — caso Hector: anunció 3 veces "procedo a generar los PDF" y nunca
// llamó la herramienta. Detecta ANUNCIOS de acción futura en el texto final.
const PROMETE_ACCION =
  /\b(procedo a|voy a (generar|crear|preparar|hacer|enviar|armar)|ahora (s[ií] )?(genero|preparo|creo|armo|envío)|te lo (genero|preparo|armo|envío)|en un momento (te|lo|la) (genero|preparo|armo|env[ií]o)|dame un momento (para|y)|enseguida (te|lo|la) (genero|preparo|armo)|prepar[ée] el (reporte|pdf|archivo|excel))\b/i;
// CP3/CP9 — además del anuncio explícito ("voy a generar"), el caso real incluyó
// una variante más traicionera: el texto afirma EN PASADO que el archivo "ya
// está listo/descárgalo abajo" sin que `generar_reporte_pdf` se haya llamado con
// éxito este turno. Enumerar frases nunca cubre todo; esta señal estructural
// (reclama una descarga que no existe) es más robusta que el regex de arriba.
const RECLAMA_ARCHIVO =
  /\b(desc[aá]rgalo|descargarlo|descarga(r)? (abajo|en la tarjeta)|listo para descargar|tarjeta de abajo|te lo descarga|conf[ií]rmalo en la tarjeta)\b/i;
function prometioYNoHizo(texto: string, huboAccionEjecutable: boolean, archivosLen: number): boolean {
  if (huboAccionEjecutable) return false;
  if (PROMETE_ACCION.test(texto)) return true;
  return archivosLen === 0 && RECLAMA_ARCHIVO.test(texto);
}

// Construye un resumen legible de la propuesta (para la tarjeta de confirmación),
// resolviendo nombres con el JWT del usuario (RLS aplica). Sella la clave de
// idempotencia y avisa si la acción saldrá marcada de prueba (BB3).
async function construirPropuesta(supabase: Any, cfg: ToolDef, input: Any, cap: Cap) {
  const tipo = cfg.write!.tipo;
  const lineas: string[] = [];
  const avisosPrueba: string[] = [];
  let titulo = "Confirmar acción";

  const clave = claveIdem(cap.usuario_id, tipo, input);
  const idemId = idemUuid(clave);
  input.__idem_id = idemId; // se usa como p_id en el execMap (idempotencia de la RPC)

  const nombreObra = async (id: string) => {
    const { data } = await supabase.from("proyectos").select("nombre, codigo, es_prueba").eq("id", id).maybeSingle();
    if (data?.es_prueba) avisosPrueba.push(`la obra "${data.nombre}" es de PRUEBA`);
    return data ? (data.codigo ? `${data.codigo} · ${data.nombre}` : data.nombre) : "obra";
  };
  const nombresArticulos = async (ids: string[]) => {
    const { data } = await supabase.from("articulos").select("id, nombre").in("id", ids);
    return new Map((data ?? []).map((a: Any) => [a.id, a.nombre]));
  };

  if (tipo === "tarea") {
    titulo = "Crear tarea";
    lineas.push(`Título: ${input.titulo}`);
    lineas.push(`Obra: ${await nombreObra(input.proyecto_id)}`);
    if (input.asignado_a) {
      const { data } = await supabase.from("usuarios").select("nombre").eq("id", input.asignado_a).maybeSingle();
      lineas.push(`Asignada a: ${data?.nombre ?? input.asignado_a}`);
    }
    lineas.push(`Prioridad: ${input.prioridad ?? "media"}`);
    if (input.fecha_limite) lineas.push(`Fecha límite: ${input.fecha_limite}`);
    if (input.descripcion) lineas.push(`Descripción: ${input.descripcion}`);
  } else if (tipo === "ruta") {
    titulo = "Asignar ruta de transporte";
    const { data: ch } = await supabase.from("usuarios").select("nombre").eq("id", input.conductor_usuario_id).maybeSingle();
    lineas.push(`Chofer: ${ch?.nombre ?? input.conductor_usuario_id}`);
    if (input.vehiculo_id) {
      const { data: v } = await supabase.from("vehiculos").select("placa, marca").eq("id", input.vehiculo_id).maybeSingle();
      if (v) lineas.push(`Vehículo: ${`${v.placa ?? ""} ${v.marca ?? ""}`.trim()}`);
    }
    if (input.proyecto_id) lineas.push(`Destino (obra): ${await nombreObra(input.proyecto_id)}`);
    if (input.destino) lineas.push(`Destino: ${input.destino}`);
    if (input.conduce_id) lineas.push(`Vinculada al conduce indicado`);
    lineas.push(`Tipo: ${input.tipo ?? "material"}`);
  } else if (tipo === "requisicion" || tipo === "conduce") {
    const items: Any[] = input.items ?? [];
    const map = await nombresArticulos(items.map((i) => i.articulo_id));
    if (tipo === "conduce") {
      titulo = "Crear conduce (salida de material)";
      const { data: b } = await supabase.from("bodegas").select("nombre, es_prueba").eq("id", input.bodega_id).maybeSingle();
      if (b?.es_prueba) avisosPrueba.push(`el almacén "${b.nombre}" es de PRUEBA`);
      lineas.push(`Origen (almacén): ${b?.nombre ?? input.bodega_id}`);
      lineas.push(`Destino (obra): ${await nombreObra(input.proyecto_id)}`);
      if (input.vehiculo_id) {
        const { data: v } = await supabase.from("vehiculos").select("placa, marca").eq("id", input.vehiculo_id).maybeSingle();
        if (v) lineas.push(`Vehículo: ${`${v.placa ?? ""} ${v.marca ?? ""}`.trim()}`);
      }
      if (input.despachante_usuario_id) {
        const { data: d } = await supabase.from("usuarios").select("nombre").eq("id", input.despachante_usuario_id).maybeSingle();
        lineas.push(`Despachante: ${d?.nombre ?? input.despachante_usuario_id}`);
      }
    } else {
      titulo = "Crear requisición de material";
      lineas.push(`Obra: ${await nombreObra(input.proyecto_id)}`);
      lineas.push(`Urgencia: ${input.urgencia ?? "media"}`);
    }
    lineas.push(`Artículos (${items.length}):`);
    for (const it of items) lineas.push(`  • ${map.get(it.articulo_id) ?? it.articulo_id} × ${it.cantidad}${it.unidad ? " " + it.unidad : ""}`);
    if (input.observaciones) lineas.push(`Obs.: ${input.observaciones}`);
    if (input.notas) lineas.push(`Notas: ${input.notas}`);
  }

  // BB3 — si el propio usuario es de prueba, también se propaga.
  const esPrueba = avisosPrueba.length > 0;
  const avisoPrueba = esPrueba
    ? `⚠️ Prueba: ${avisosPrueba.join(" y ")} — este ${tipo} saldrá marcado como de PRUEBA (no es real).`
    : null;

  return { tipo, tool: cfg.name, params: input, titulo, lineas, idem: clave, es_prueba: esPrueba, aviso_prueba: avisoPrueba };
}

// CV1 — "preparar + abrir formulario": a diferencia de construirPropuesta()
// (que arma una tarjeta Confirmar/Cancelar para una RPC de escritura), esta
// arma una propuesta `accion:'abrir'` que SOLO navega al formulario real con
// los datos como queryParams. Nunca ejecuta nada ni genera idem — no hay
// documento que deduplicar, solo se abre una pantalla.
async function construirPropuestaAbrir(supabase: Any, cfg: ToolDef, input: Any): Promise<Any> {
  const tipo = cfg.abrir!.tipo; // 'echada'

  if (tipo === "echada") {
    // CV1.3 — validación ligera del servidor (el formulario/RPC aplican los
    // topes reales de capacidad/precio/odómetro; esto solo evita basura obvia).
    const galones = Number(input.galones);
    const monto = Number(input.monto);
    const km = input.km === undefined || input.km === null || input.km === "" ? null : Math.trunc(Number(input.km));
    if (!Number.isFinite(galones) || galones <= 0 || galones > 500) {
      return { error: "Los galones deben ser un número entre 0 y 500." };
    }
    if (!Number.isFinite(monto) || monto < 0) {
      return { error: "El monto no es válido." };
    }
    if (km !== null && (!Number.isFinite(km) || km < 0)) {
      return { error: "El kilometraje no es válido." };
    }
    const estacion = input.estacion ? String(input.estacion).slice(0, 60) : null;
    const producto = input.producto ? String(input.producto).slice(0, 60) : null;

    // CV1 — resuelve el nombre del vehículo CON EL JWT del usuario (RLS): si no
    // lo ve, vehiculo_display() devuelve null (no hay fila visible que unir).
    const { data: nombreVeh } = await supabase.rpc("vehiculo_display", { p_id: input.vehiculo_id });
    if (!nombreVeh) {
      return { error: "No pude identificar ese vehículo con tu acceso. Revisa cuál es y vuelve a intentarlo." };
    }

    const faltan = ["Foto del recibo", "Foto del tablero"];
    if (km === null) faltan.push("Lectura del odómetro");

    const query: Record<string, string | number> = { desde: "compa", vehiculo: input.vehiculo_id, galones, monto };
    if (km !== null) query["km"] = km;
    if (estacion) query["estacion"] = estacion;
    if (producto) query["producto"] = producto;

    return {
      propuesta: {
        tipo: "echada_formulario", tool: cfg.name, accion: "abrir",
        titulo: "Echada preparada",
        lineas: [
          `Vehículo: ${nombreVeh}`,
          `Galones: ${galones}`,
          `Monto: RD$ ${monto.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`,
          `Fecha: Hoy`,
          ...(km !== null ? [`Odómetro: ${km} km`] : []),
        ],
        faltan,
        // Contrato CV1 (PARIDAD.md): el destino NO fija una ruta — cada cliente
        // (web: /flota/combustible; app: Transporte → Combustible) arma su propia
        // navegación con estos queryParams.
        destino: { vehiculo_id: input.vehiculo_id, query },
        params: input,
      },
    };
  }
  return { error: "Tipo de propuesta desconocido." };
}

// ── AY11/C2 — Reportes PDF ──────────────────────────────────────────────────
// Cada reporte trae sus datos de una consulta con el JWT del usuario (RLS aplica
// → hereda permisos). Devuelve { titulo, cols, rows } o null si no hay/no puede.
async function datosReporte(supabase: Any, tipo: string, input: Any):
  Promise<{ titulo: string; cols: string[]; rows: string[][] } | null> {
  const s = (v: Any) => (v === null || v === undefined ? "" : String(v));
  if (tipo === "usuarios") {
    const { data } = await supabase.from("usuarios").select("nombre, email, activo").order("nombre");
    if (!data?.length) return null;
    return { titulo: "Listado de usuarios", cols: ["Nombre", "Email", "Activo"],
      rows: data.map((u: Any) => [s(u.nombre), s(u.email), u.activo ? "Sí" : "No"]) };
  }
  if (tipo === "stock_almacen") {
    if (!input.bodega_id) return null;
    const { data, error } = await supabase.rpc("inventario_almacen",
      { p_bodega_id: input.bodega_id, p_incluir_cero: false, p_busqueda: null, p_incluir_catalogo: false });
    if (error || !data?.length) return null;
    return { titulo: "Stock por almacén", cols: ["Código", "Artículo", "Unidad", "Cantidad"],
      rows: data.map((r: Any) => [s(r.codigo), s(r.nombre), s(r.unidad), s(r.cantidad)]) };
  }
  if (tipo === "requisiciones") {
    const { data, error } = await supabase.rpc("requisiciones_bandeja", {
      p_estado: input.estado ?? null, p_proyecto_id: input.proyecto_id ?? null, p_urgencia: null,
      p_busqueda: null, p_limite: 200, p_desde: input.desde ?? null, p_hasta: input.hasta ?? null,
      p_solicitante_id: input.solicitante_id ?? null,
    });
    const arr: Any[] = Array.isArray(data) ? data : [];
    if (error || !arr.length) return null;
    return { titulo: "Requisiciones de material", cols: ["Folio", "Obra", "Solicitante", "Estado", "Fecha"],
      rows: arr.map((r: Any) => [s(r.codigo ?? r.folio), s(r.proyecto_nombre ?? r.proyecto), s(r.solicitante), s(r.estado), s(r.created_at).slice(0, 10)]) };
  }
  if (tipo === "desempeno_semana") {
    const { data, error } = await supabase.rpc("desempeno_semana",
      { p_anio: input.anio ?? null, p_semana: input.semana ?? null });
    const arr: Any[] = Array.isArray(data) ? data : [];
    if (error || !arr.length) return null;
    return { titulo: "Desempeño de choferes (semana)", cols: ["Chofer", "Puntaje", "Mínimo", "Cumplió", "Decisión"],
      rows: arr.map((r: Any) => [s(r.nombre), s(r.puntaje), s(r.minimo), r.cumplio ? "Sí" : "No", s(r.decision ?? "—")]) };
  }
  if (tipo === "conduces_dia") {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data } = await supabase.from("salidas_inventario")
      .select("id, estado, created_at, proyecto:proyectos(nombre)")
      .gte("created_at", hoy + "T00:00:00").order("created_at", { ascending: false });
    if (!data?.length) return null;
    return { titulo: "Conduces emitidos hoy", cols: ["Obra", "Estado", "Hora"],
      rows: data.map((r: Any) => [s(r.proyecto?.nombre), s(r.estado), s(r.created_at).slice(11, 16)]) };
  }
  return null;
}

// CP3/CP9 — stock de VARIOS almacenes: una sección por almacén, en el orden
// pedido. Cada almacén que no tenga datos/acceso simplemente se omite (no rompe
// el resto); si ninguno tiene datos, devuelve [].
async function datosStockAlmacenes(supabase: Any, bodegaIds: string[]):
  Promise<{ titulo: string; cols: string[]; rows: string[][] }[]> {
  const s = (v: Any) => (v === null || v === undefined ? "" : String(v));
  const secciones: { titulo: string; cols: string[]; rows: string[][] }[] = [];
  for (const id of bodegaIds) {
    const { data: bodega } = await supabase.from("bodegas").select("nombre").eq("id", id).maybeSingle();
    const { data, error } = await supabase.rpc("inventario_almacen",
      { p_bodega_id: id, p_incluir_cero: false, p_busqueda: null, p_incluir_catalogo: false });
    if (error || !data?.length) continue;
    secciones.push({
      titulo: bodega?.nombre ?? "Almacén",
      cols: ["Código", "Artículo", "Unidad", "Cantidad"],
      rows: data.map((r: Any) => [s(r.codigo), s(r.nombre), s(r.unidad), s(r.cantidad)]),
    });
  }
  return secciones;
}

// CP3/CP9 — hallazgo real durante los evals: pdf-lib con StandardFonts usa
// codificación WinAnsi (Windows-1252) y LANZA si el texto trae un carácter
// fuera de ese rango (p. ej. ″ U+2033, comilla de pulgadas en "TUBO 2″" del
// catálogo) — tumbaba CADA PDF que incluyera un artículo así, en silencio para
// el usuario (Compa solo veía "falló" y lo reintentaba sin arreglar nada).
function winAnsiSafe(t: string): string {
  if (!t) return t;
  return t
    .replace(/[′]/g, "'")   // prime (pies/minutos) → apóstrofo
    .replace(/[″]/g, '"')   // double prime (pulgadas) → comillas rectas
    .replace(/[^\x00-\xFF]/g, "?"); // cualquier otro carácter fuera de Latin-1
}

// Compone un PDF tabular sencillo (multipágina) con pdf-lib.
async function componerPdf(titulo: string, subtitulo: string, cols: string[], rows: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40; // A4 portrait
  const gray = rgb(0.4, 0.4, 0.4), black = rgb(0.1, 0.1, 0.1);
  const colW = (W - 2 * M) / cols.length;
  const clip = (raw: string, max: number) => { const t = winAnsiSafe(raw); return t.length > max ? t.slice(0, max - 1) + "…" : t; };
  const maxChars = Math.max(6, Math.floor(colW / 5.2));
  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(clip(titulo, 70), { x: M, y, size: 16, font: bold, color: black }); y -= 20;
  page.drawText(clip(subtitulo, 110), { x: M, y, size: 9, font, color: gray }); y -= 22;
  const header = () => {
    cols.forEach((c, i) => page.drawText(clip(c, maxChars), { x: M + i * colW, y, size: 9, font: bold, color: black }));
    y -= 14;
  };
  header();
  for (const row of rows) {
    if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; header(); }
    row.forEach((cell, i) => page.drawText(clip(cell ?? "", maxChars), { x: M + i * colW, y, size: 8.5, font, color: black }));
    y -= 12;
  }
  return await doc.save();
}

// CP3/CP9 — variante de componerPdf con VARIAS secciones (p. ej. stock de
// varios almacenes en un solo PDF, uno por sección, en el orden pedido).
async function componerPdfMultiSeccion(
  titulo: string, subtitulo: string, secciones: { titulo: string; cols: string[]; rows: string[][] }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  const gray = rgb(0.4, 0.4, 0.4), black = rgb(0.1, 0.1, 0.1), navy = rgb(0.12, 0.23, 0.37);
  const clip = (raw: string, max: number) => { const t = winAnsiSafe(raw); return t.length > max ? t.slice(0, max - 1) + "…" : t; };
  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(clip(titulo, 70), { x: M, y, size: 16, font: bold, color: black }); y -= 20;
  page.drawText(clip(subtitulo, 110), { x: M, y, size: 9, font, color: gray }); y -= 22;
  for (const sec of secciones) {
    const colW = (W - 2 * M) / sec.cols.length;
    const maxChars = Math.max(6, Math.floor(colW / 5.2));
    if (secciones.length > 1) {
      if (y < M + 60) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(clip(sec.titulo, 90), { x: M, y, size: 12, font: bold, color: navy }); y -= 18;
    }
    const header = () => {
      sec.cols.forEach((c, i) => page.drawText(clip(c, maxChars), { x: M + i * colW, y, size: 9, font: bold, color: black }));
      y -= 14;
    };
    header();
    for (const row of sec.rows) {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; header(); }
      row.forEach((cell, i) => page.drawText(clip(cell ?? "", maxChars), { x: M + i * colW, y, size: 8.5, font, color: black }));
      y -= 12;
    }
    y -= 10; // respiro entre secciones
  }
  return await doc.save();
}

// Compone un Excel (.xlsx) con encabezados + filas.
function componerExcel(titulo: string, cols: string[], rows: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 28) || "Reporte");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  if (!ANTHROPIC_API_KEY) return json({ error: "El asistente no está configurado todavía (falta la API key). Avísale a Tecnología." }, 503);

  let payload: { conversacion_id?: string; mensaje?: string; ejecutar?: Any; telefono?: string };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }

  let authHeader = req.headers.get("Authorization");
  let viaWhatsapp = false;

  // ── BJ2 — Modo WhatsApp: el puente n8n llama con un secreto compartido + el
  // teléfono del remitente. Resolvemos el teléfono a un usuario SGC (lista blanca)
  // y le abrimos una sesión REAL (enlace mágico, sin tocar su contraseña) para que
  // TODO el flujo —capacidades, gates de cada tool, RLS— corra como ESA persona.
  // Un número fuera de la lista recibe un mensaje amable y nada de datos.
  const waSecret = req.headers.get("x-wa-secret");
  if (waSecret && WHATSAPP_ASSISTANT_SECRET && waSecret === WHATSAPP_ASSISTANT_SECRET) {
    // el teléfono puede venir en el body o en un header (el tool de n8n lo manda por header)
    const telefono = String(payload?.telefono ?? req.headers.get("x-wa-telefono") ?? "").trim();
    const mensajeWa = String(payload?.mensaje ?? "").trim();
    if (!mensajeWa) return json({ reply: "" });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "sgc" }, auth: { persistSession: false } });
    const { data: resolved } = await admin.rpc("whatsapp_resolver", { p_telefono: telefono });
    const row = Array.isArray(resolved) ? resolved[0] : resolved;
    if (!row?.email) {
      return json({ reply: "Hola 👋 Este número no está autorizado para consultar a Compa por aquí. Si crees que es un error, escríbele a Tecnología." });
    }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: row.email });
    const tokenHash = (link as Any)?.properties?.hashed_token;
    if (linkErr || !tokenHash) return json({ reply: "No pude abrir tu sesión de Compa ahora mismo. Reinténtalo en un momento." });
    const vres = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
    });
    const vj = await vres.json().catch(() => null);
    if (!vj?.access_token) return json({ reply: "No pude abrir tu sesión de Compa. Reinténtalo." });
    authHeader = `Bearer ${vj.access_token}`;
    viaWhatsapp = true;
    // Conversación efímera por mensaje (Q&A). El resto del flujo es idéntico.
    payload = { mensaje: mensajeWa };
  }

  if (!authHeader) return json({ error: "No autorizado" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  // Capacidades del usuario.
  const { data: cap, error: capErr } = await supabase.rpc("capacidades_asistente");
  if (capErr || !cap) return json({ error: "No pude leer tus permisos." }, 500);
  const modulos: string[] = Array.isArray(cap.modulos) ? cap.modulos : [];
  const roles: string[] = Array.isArray(cap.roles) ? cap.roles : [];
  const capObj: Cap = { usuario_id: cap.usuario_id, nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin, modulos, roles };

  // ── CI10 — consentimiento de IA explícito (Anthropic). Verificado en servidor.
  // No aplica al puente WhatsApp (canal fuera de tiendas, sin hoja de consentimiento).
  if (!viaWhatsapp) {
    const { data: consentOk } = await supabase.rpc("mi_consentimiento", { p_tipo: "ia" });
    if (!consentOk) {
      return json({
        error: "Para usar el asistente con inteligencia artificial, primero actívalo en Perfil › Privacidad.",
        error_code: "sin_consentimiento_ia",
      }, 403);
    }
  }

  // ── Branch CONFIRMAR: ejecuta la acción preparada (mismo RPC del flujo normal) ──
  if (payload.ejecutar) {
    const prop = payload.ejecutar;
    const convId = payload.conversacion_id ?? null;
    // CV1.4 — una propuesta `accion:'abrir'` (p. ej. preparar_echada) no tiene
    // `write`: nunca se "confirma" por esta vía, se completa en el formulario.
    // Un cliente viejo (o uno que no sepa de accion:'abrir') que intente
    // confirmarla de todos modos recibe un mensaje claro, no un 400 genérico.
    const cfgAbrir = TOOLS.find((t) => t.name === prop.tool && t.abrir && !t.write);
    if (cfgAbrir) {
      return json({
        conversacion_id: convId,
        respuesta: "Esta acción se completa en el formulario de Combustible (Flota → Combustible; en la app, Transporte → Combustible). Ahí agregas las fotos.",
        ejecutado: false,
      });
    }
    const cfg = TOOLS.find((t) => t.name === prop.tool && t.write);
    if (!cfg) return json({ error: "Acción no reconocida." }, 400);
    if (!(cfg.modulos === null || capObj.es_admin || cfg.modulos!.some((m) => modulos.includes(m)))) {
      return json({ error: "No tienes permiso para esa acción." }, 403);
    }

    const mensajeExito = (tipo: string) =>
      tipo === "conduce" ? "✅ Conduce creado. Queda pendiente de firma por el flujo normal."
        : tipo === "requisicion" ? "✅ Requisición creada y enviada a aprobación."
        : tipo === "ruta" ? "✅ Ruta asignada. Queda planificada para el chofer."
        : "✅ Tarea creada y asignada.";

    // BB3 — idempotencia: la clave viene del preparar (params.__idem) o se recalcula.
    const clave = prop.idem ?? claveIdem(capObj.usuario_id, cfg.write!.tipo, prop.params ?? {});

    // "Claim" atómico: la PK de assistant_idempotencia evita doble ejecución concurrente.
    const { error: claimErr } = await supabase.from("assistant_idempotencia")
      .insert({ clave, conversacion_id: convId, tool: prop.tool, estado: "ejecutando" });
    if (claimErr) {
      // Solo tratamos como duplicado si EXISTE una fila previa con esa clave. Si el claim
      // falló por otra razón (p. ej. la tabla aún no está desplegada), NO bloqueamos la
      // acción: seguimos y ejecutamos (fail-open) para no dejar al usuario trancado.
      const { data: prev } = await supabase.from("assistant_idempotencia").select("resultado").eq("clave", clave).maybeSingle();
      if (prev) {
        const respuesta = prev?.resultado?.mensaje ?? "Esta acción ya la habías confirmado — no la repetí para no duplicarla.";
        return json({ conversacion_id: convId, respuesta, ejecutado: true, duplicado: true });
      }
    }

    let respuesta = "";
    let ok = false;
    try {
      const { error } = await supabase.rpc(cfg.write!.execRpc, cfg.write!.execMap(prop.params, capObj));
      if (error) {
        respuesta = `No se pudo completar: ${error.message}`;
      } else {
        ok = true;
        respuesta = mensajeExito(cfg.write!.tipo);
      }
    } catch (e) {
      respuesta = `No se pudo completar: ${e instanceof Error ? e.message : "error"}`;
    }
    // Cierra la clave de idempotencia con el resultado (o la marca en error para permitir reintento).
    await supabase.from("assistant_idempotencia")
      .update({ estado: ok ? "hecho" : "error", resultado: { ok, mensaje: respuesta }, updated_at: new Date().toISOString() })
      .eq("clave", clave).then(() => {}, () => {});
    if (!ok) {
      // Si falló, borra el claim para que un reintento legítimo pueda re-ejecutar.
      await supabase.from("assistant_idempotencia").delete().eq("clave", clave).then(() => {}, () => {});
    }
    if (convId) {
      await supabase.from("assistant_acciones").insert({ conversacion_id: convId, tool: prop.tool, params: prop.params, ok, resumen: respuesta.slice(0, 200) }).then(() => {}, () => {});
      await supabase.from("assistant_mensajes").insert({ conversacion_id: convId, rol: "assistant", contenido: respuesta }).then(() => {}, () => {});
    }
    return json({ conversacion_id: convId, respuesta, ejecutado: ok });
  }

  // ── Branch CHAT ────────────────────────────────────────────────────────────
  const mensaje = fixMojibake((payload.mensaje ?? "").toString().trim());
  if (!mensaje) return json({ error: "Mensaje vacío" }, 400);
  if (mensaje.length > 4000) return json({ error: "Mensaje demasiado largo" }, 400);

  const { data: usados } = await supabase.rpc("assistant_mensajes_ultima_hora");
  if (typeof usados === "number" && usados >= MAX_MSGS_HORA) {
    return json({ error: `Vas muy rápido 😅 (límite ${MAX_MSGS_HORA} mensajes/hora). Espera un momento.` }, 429);
  }

  let convId = payload.conversacion_id ?? null;
  if (!convId) {
    const { data: nueva, error: convErr } = await supabase.from("assistant_conversaciones").insert({ titulo: mensaje.slice(0, 60) }).select("id").single();
    if (convErr) return json({ error: "No pude iniciar la conversación." }, 500);
    convId = nueva!.id as string;
  }

  const { data: previos } = await supabase.from("assistant_mensajes").select("rol, contenido").eq("conversacion_id", convId).order("created_at", { ascending: true }).limit(40);
  const messages: Any[] = (previos ?? []).filter((m: Any) => m.contenido).map((m: Any) => ({ role: m.rol === "assistant" ? "assistant" : "user", content: m.contenido }));
  messages.push({ role: "user", content: mensaje });

  const disponibles = toolsParaUsuario(capObj);
  // BB4(3) — schemas estrictos: additionalProperties:false en cada tool (Anthropic no
  // tiene flag `strict`, pero esto fuerza la forma exacta y evita parámetros basura).
  const tools: Any[] = disponibles.map((t, idx) => ({
    name: t.name,
    description: t.description,
    input_schema: { additionalProperties: false, ...t.input_schema },
    ...(idx === disponibles.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));

  // CO6/#216 — "buscar_en_internet": el web search NATIVO de Anthropic (server
  // tool) — Anthropic ejecuta la búsqueda y cita fuentes solo, no hay dispatch
  // local. Apagable por parámetro (compa_web_search, default encendido) y
  // limitado por CONVERSACIÓN (no solo por turno) para no disparar el gasto.
  const MAX_WEB_SEARCH_POR_CONVERSACION = 5;
  try {
    const { data: paramRow } = await supabase.from("parametros").select("valor").eq("clave", "compa_web_search").maybeSingle();
    const webSearchOn = (paramRow?.valor ?? "true") === "true";
    if (webSearchOn) {
      const { count } = await supabase.from("assistant_acciones")
        .select("id", { count: "exact", head: true })
        .eq("conversacion_id", convId).eq("tool", "web_search");
      if ((count ?? 0) < MAX_WEB_SEARCH_POR_CONVERSACION) {
        tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 3 });
      }
    }
  } catch { /* si falla la lectura del parámetro, se omite el tool (falla cerrado) */ }

  // AY C4 — inyecta la memoria del usuario (lo que Compa recuerda de él).
  let memText = "";
  try {
    const { data: mems } = await supabase.from("assistant_memory").select("clave, valor").limit(30);
    if (mems?.length) {
      memText = "\n\nLO QUE RECUERDAS DE ESTE USUARIO (memoria; puede estar desactualizada — verifica con una herramienta si vas a actuar sobre un dato):\n"
        + mems.map((m: Any) => `- ${m.clave}: ${m.valor}`).join("\n");
    }
  } catch { /* memoria opcional */ }

  // BB4(5) — system en dos bloques: instrucciones ESTÁTICAS cacheadas (compartidas,
  // alto cache-hit) + identidad DINÁMICA por request (nunca cacheada → jamás se cruza
  // la identidad de un usuario con la de otro).
  const system = [
    { type: "text", text: INSTRUCCIONES_ESTATICAS, cache_control: { type: "ephemeral" } },
    { type: "text", text: bloqueIdentidad(capObj, ahoraRD(), listaHerramientasCompacta(disponibles)) + memText },
  ];
  const debeForzarTool = fuerzaHerramienta(mensaje);

  const herramientasUsadas: { tool: string; ok: boolean }[] = [];
  let propuesta: Any = null;
  // CP3/CP9 — VARIOS archivos por turno (antes: una sola variable que se pisaba,
  // "15 PDFs" en un turno dejaba solo el último). Tope 20 por turno.
  const archivos: { nombre: string; url: string }[] = [];
  const MAX_ARCHIVOS_POR_TURNO = 20;
  let respuestaFinal = "";
  // BE2 — último fallo de herramienta (para el mensaje de causa+salida sin excusa vacía).
  let ultimoFallo: { motivo: "sin_permiso" | "error_de_tool"; tool: string } | null = null;
  // CP3/CP9 — qué herramientas de ESCRITURA/ARCHIVO se llamaron de verdad este turno
  // (para el validador "prometió y no hizo": si el texto anuncia una acción y esta
  // lista sigue vacía, es una promesa vacía).
  let huboAccionEjecutable = false;
  // CP3/CP9 — cuando se rechaza un gap falso (herramientaQueCoincide encontró
  // una tool real), no basta con decírselo al modelo en el tool_result: a veces
  // igual responde "no tengo esa herramienta" en el texto final sin llamarla.
  // Esta bandera FUERZA esa tool exacta en la siguiente vuelta del loop (no solo
  // en la vuelta 0), y se limpia tras usarse una vez.
  let forzarToolSiguiente: string | null = null;

  // BE2 — registra una consulta NO ATENDIDA (backlog de Tecnología). Institucionaliza
  // las capturas a mano: cada gap/fallo queda con { pregunta, rol, motivo, fecha }.
  async function registrarNoAtendida(
    motivo: "sin_tool" | "error_de_tool" | "sin_permiso", tool: string | null, detalle: string | null,
  ) {
    await supabase.rpc("registrar_consulta_no_atendida", {
      p_pregunta: mensaje, p_motivo: motivo, p_tool: tool ?? null,
      p_detalle: detalle ? detalle.slice(0, 400) : null, p_conversacion_id: convId,
    }).then(() => {}, () => {});
  }

  // Corre el ciclo de tool-use hasta que Claude produzca texto. `forzarPrimera`
  // aplica tool_choice:any en la 1ª vuelta (router de intención / validador).
  async function correrLoop(forzarPrimera: boolean): Promise<string> {
    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      // BB4(2) — en la 1ª vuelta, si la intención pide datos/verificación, forzamos
      // una tool (tool_choice:any). Estructuralmente impide "acabo de consultarlo" sin consulta.
      const forceThis = forzarToolSiguiente
        ? { type: "tool", name: forzarToolSiguiente }
        : (loop === 0 && forzarPrimera ? { type: "any" } : undefined);
      forzarToolSiguiente = null; // se consume en esta vuelta, no se repite sola
      const resp = await callClaude(system, tools, messages, forceThis);
      const content: Any[] = resp.content ?? [];

      // CO6 — web_search es un server tool: Anthropic lo ejecuta por su cuenta
      // (puede aparecer con stop_reason "end_turn" si ya cerró el turno con el
      // resultado incluido). Solo lo auditamos/contamos para el tope por conversación.
      for (const b of content.filter((x) => x.type === "server_tool_use" && x.name === "web_search")) {
        herramientasUsadas.push({ tool: "web_search", ok: true });
        await supabase.from("assistant_acciones").insert({
          conversacion_id: convId, tool: "web_search", params: { query: b.input?.query ?? null },
          ok: true, resumen: String(b.input?.query ?? "").slice(0, 200),
        }).then(() => {}, () => {});
      }

      if (resp.stop_reason === "tool_use") {
        const results: Any[] = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          const cfg = disponibles.find((t) => t.name === block.name);
          let out: unknown; let ok = false; let resumen = "";
          if (!cfg) {
            out = { error: "Herramienta no disponible." };
          } else if (cfg.gap) {
            // CP3/CP9 — caso Hector: dijo "no tengo herramienta para listar
            // almacenes" teniendo 'listar_almacenes' — el modelo nunca revisó su
            // propia lista. ANTES de aceptar el gap, lo comparamos contra el
            // nombre/descripción de las herramientas que el usuario SÍ tiene; si
            // hay coincidencia, se rechaza (no se registra como falta real) y se
            // le dice al modelo cuál usar, para que repita la vuelta.
            const inp = block.input ?? {};
            const tema = String(inp.tema ?? "").toLowerCase();
            const match = tema ? herramientaQueCoincide(tema, disponibles) : null;
            if (match) {
              out = {
                rechazado: true, usa: match.name,
                instruccion: `Sí tienes la herramienta '${match.name}' para esto: úsala ahora en vez de decir que no puedes. No registres este gap — no es una falta real.`,
              };
              resumen = `gap rechazado (coincide con ${match.name})`;
              ok = false;
              // Solo forzamos la tool en la vuelta siguiente si no requiere
              // argumentos (no hay con qué resolverlos aquí sin inventar datos).
              if (!(match.input_schema as Any)?.required?.length) forzarToolSiguiente = match.name;
            } else {
              // BE2 — Compa declara que le falta una capacidad → al backlog (sin_tool).
              try {
                await registrarNoAtendida("sin_tool", null, String(inp.tema ?? ""));
                out = { registrado: true, instruccion: "Ya quedó anotado para Tecnología. Ahora dile al usuario con honestidad qué NO puedes hacer todavía y ofrécele una alternativa concreta de lo que SÍ puedes. Nada de excusas vacías." };
                ok = true; resumen = `gap: ${String(inp.tema ?? "").slice(0, 60)}`;
              } catch (e) { out = { error: "No pude registrar el gap." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
            }
          } else if (cfg.memoria) {
            // AY C4 — guarda una preferencia del propio usuario (escritura benigna, sin tarjeta).
            try {
              const inp = block.input ?? {};
              const { error } = await supabase.rpc("recordar_memoria", { p_clave: String(inp.clave ?? ""), p_valor: String(inp.valor ?? "") });
              if (error) { out = { error: "No pude guardar eso." }; resumen = error.message.slice(0, 200); }
              else { out = { guardado: true }; ok = true; resumen = `memoria: ${String(inp.clave ?? "").slice(0, 60)}`; }
            } catch (e) { out = { error: "No pude guardar eso." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
          } else if (cfg.pdf) {
            // CP3/CP9 — genera uno o varios archivos con datos consultados con el
            // JWT del usuario (hereda RLS). 'stock_almacen' con varios bodega_ids
            // arma un PDF con una sección por almacén (o separados, si lo piden).
            try {
              const inp = block.input ?? {};
              if (archivos.length >= MAX_ARCHIVOS_POR_TURNO) {
                out = { error: `Ya se generaron ${MAX_ARCHIVOS_POR_TURNO} archivos en este turno, el máximo. Pide el resto en otro mensaje.` };
                resumen = "tope de archivos por turno alcanzado";
              } else {
                const tipo = String(inp.tipo ?? "");
                const esExcel = String(inp.formato ?? "pdf").toLowerCase() === "excel";
                const fecha = new Date().toISOString().slice(0, 16).replace("T", " ");
                const bodegaIds: string[] = Array.isArray(inp.bodega_ids) && inp.bodega_ids.length
                  ? inp.bodega_ids.map(String)
                  : (inp.bodega_id ? [String(inp.bodega_id)] : []);

                const subirArchivo = async (titulo: string, cols: string[], rows: string[][], bytesOverride?: Uint8Array) => {
                  const ext = esExcel ? "xlsx" : "pdf";
                  const ctype = esExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
                  const bytes = bytesOverride ?? (esExcel
                    ? componerExcel(titulo, cols, rows)
                    : await componerPdf(titulo, `Generado por ${capObj.nombre} · ${fecha}`, cols, rows));
                  const path = `${capObj.usuario_id}/${crypto.randomUUID()}.${ext}`;
                  const { error: upErr } = await supabase.storage.from("reportes").upload(path, bytes, { contentType: ctype });
                  if (upErr) return null;
                  const { data: signed } = await supabase.storage.from("reportes").createSignedUrl(path, 3600);
                  return { nombre: `${titulo}.${ext}`, url: signed?.signedUrl ?? "" };
                };

                if (tipo === "stock_almacen" && bodegaIds.length > 1) {
                  const secciones = await datosStockAlmacenes(supabase, bodegaIds.slice(0, MAX_ARCHIVOS_POR_TURNO - archivos.length));
                  if (!secciones.length) {
                    out = { error: "No hay datos para esos almacenes o no tienes acceso." };
                    resumen = "stock multi-almacén sin datos/permiso";
                  } else if (inp.separados) {
                    let subidos = 0;
                    for (const sec of secciones) {
                      const f = await subirArchivo(`Stock — ${sec.titulo}`, sec.cols, sec.rows);
                      if (f) { archivos.push(f); subidos++; }
                    }
                    out = { generado: subidos > 0, archivos: subidos, instruccion: "Dile al usuario que sus archivos (uno por almacén) están listos para descargar abajo." };
                    ok = subidos > 0; resumen = `${subidos} archivos de stock (separados)`;
                    huboAccionEjecutable = huboAccionEjecutable || ok;
                  } else {
                    const bytes = esExcel
                      ? componerExcel("Stock por almacén", ["Almacén", ...secciones[0].cols], secciones.flatMap((s) => s.rows.map((r) => [s.titulo, ...r])))
                      : await componerPdfMultiSeccion("Stock por almacén", `Generado por ${capObj.nombre} · ${fecha}`, secciones);
                    const f = await subirArchivo("Stock por almacén", [], [], bytes);
                    if (!f) { out = { error: "No se pudo guardar el archivo." }; resumen = "fallo al subir stock multi-almacén"; }
                    else {
                      archivos.push(f);
                      out = { generado: true, nombre: f.nombre, secciones: secciones.length, instruccion: "Dile al usuario que su archivo (con una sección por almacén) está listo para descargar abajo." };
                      ok = true; resumen = `1 archivo, ${secciones.length} secciones`;
                      huboAccionEjecutable = true;
                    }
                  }
                } else {
                  const datosIn = bodegaIds.length === 1 && tipo === "stock_almacen" ? { ...inp, bodega_id: bodegaIds[0] } : inp;
                  const datos = await datosReporte(supabase, tipo, datosIn);
                  if (!datos) {
                    out = { error: "No hay datos para ese reporte o no tienes acceso." };
                    resumen = "reporte sin datos/permiso";
                  } else {
                    const f = await subirArchivo(datos.titulo, datos.cols, datos.rows);
                    if (!f) { out = { error: "No se pudo guardar el archivo." }; resumen = "fallo al subir"; }
                    else {
                      archivos.push(f);
                      out = { generado: true, nombre: f.nombre, filas: datos.rows.length, instruccion: "Dile al usuario que su archivo está listo para descargar en la tarjeta de abajo." };
                      ok = true; resumen = `${datos.rows.length} filas`;
                      huboAccionEjecutable = true;
                    }
                  }
                }
              }
            } catch (e) { out = { error: "No se pudo generar el archivo." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
          } else if (cfg.abrir) {
            // CV1 — "preparar + abrir formulario": nunca ejecuta nada; solo arma
            // la propuesta con accion:'abrir' para que el usuario la termine en
            // el formulario real (fotos, odómetro, "Guardar" los pone él).
            try {
              const res = await construirPropuestaAbrir(supabase, cfg, block.input ?? {});
              if (res.error) {
                out = { error: res.error };
                resumen = res.error.slice(0, 200);
              } else {
                propuesta = res.propuesta;
                out = {
                  preparado: true,
                  resumen: propuesta.lineas.join("\n"),
                  faltan: propuesta.faltan,
                  instruccion: "Dile al usuario EN UNA FRASE qué dejaste preparado y que las fotos y el odómetro se completan en el formulario — todavía NO está registrada. Nunca digas que ya quedó guardada.",
                };
                ok = true; resumen = `propuesta abrir ${cfg.abrir.tipo}`;
                huboAccionEjecutable = true;
              }
            } catch (e) {
              out = { error: "No pude preparar la acción." };
              resumen = (e instanceof Error ? e.message : "error").slice(0, 200);
            }
          } else if (cfg.write) {
            // Acción de ESCRITURA: se PREPARA, no se ejecuta. Devuelve borrador.
            try {
              propuesta = await construirPropuesta(supabase, cfg, block.input ?? {}, capObj);
              out = {
                preparado: true,
                resumen: propuesta.lineas.join("\n"),
                aviso_prueba: propuesta.aviso_prueba ?? undefined,
                instruccion: propuesta.es_prueba
                  ? "Dile en una frase qué preparaste, ADVIERTE que saldrá marcado de prueba (usa el texto de aviso_prueba) y pídele que confirme en la tarjeta. No digas que ya está hecho."
                  : "Dile al usuario en una frase qué preparaste y que confirme en la tarjeta. No digas que ya está hecho.",
              };
              ok = true; resumen = `propuesta ${cfg.write.tipo}`;
              huboAccionEjecutable = true;
            } catch (e) {
              out = { error: "No pude preparar la acción." };
              resumen = (e instanceof Error ? e.message : "error").slice(0, 200);
            }
          } else {
            // Lectura.
            try {
              const { data, error } = await ejecutarHerramientaLectura(supabase, cfg, block.input ?? {});
              if (error) {
                // BE2 — distingue sin_permiso vs error de tool para el mensaje y el backlog.
                const esPermiso = /42501|permission|no autorizado|autorizad/i.test(error.message || "");
                out = { error: esPermiso ? "No tienes acceso a eso con tu rol." : "La consulta falló por un problema técnico (ya lo reporté a Tecnología)." };
                resumen = error.message.slice(0, 200);
                ultimoFallo = { motivo: esPermiso ? "sin_permiso" : "error_de_tool", tool: block.name };
                await registrarNoAtendida(esPermiso ? "sin_permiso" : "error_de_tool", block.name, error.message);
              }
              else { out = data ?? []; ok = true; resumen = Array.isArray(data) ? `${data.length} fila(s)` : "ok"; }
            } catch (e) {
              const msg = e instanceof Error ? e.message : "error";
              out = { error: "La consulta falló por un problema técnico (ya lo reporté a Tecnología)." };
              resumen = msg.slice(0, 200);
              ultimoFallo = { motivo: "error_de_tool", tool: block.name };
              await registrarNoAtendida("error_de_tool", block.name, msg);
            }
          }
          herramientasUsadas.push({ tool: block.name, ok });
          await supabase.from("assistant_acciones").insert({ conversacion_id: convId, tool: block.name, params: block.input ?? {}, ok, resumen }).then(() => {}, () => {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 18000) });
        }
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: results });
        continue;
      }
      return content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    }
    return "";
  }

  try {
    respuestaFinal = await correrLoop(debeForzarTool);

    // BB4(4) — Validador post-respuesta: si el texto AFIRMA verificación y el turno NO
    // tuvo tool calls, es una mentira ("acabo de consultarlo"). Se regenera forzando una
    // herramienta; si aún así insiste sin consultar, se antepone un aviso honesto.
    if (afirmaVerificacionSinTool(respuestaFinal, herramientasUsadas.length > 0)) {
      await supabase.from("assistant_acciones").insert({
        conversacion_id: convId, tool: "validador_honestidad",
        params: { texto: respuestaFinal.slice(0, 200) }, ok: false,
        resumen: "afirmó verificación sin llamar herramienta → regenerado",
      }).then(() => {}, () => {});
      messages.push({ role: "assistant", content: respuestaFinal });
      messages.push({ role: "user", content: "Afirmaste que consultaste/verificaste algo, pero en ese turno NO llamaste ninguna herramienta. Corrige AHORA: llama la herramienta correcta y responde con el dato real; si no existe herramienta para eso, dilo con claridad y NO afirmes que lo verificaste." });
      const segundo = await correrLoop(true);
      if (segundo) {
        respuestaFinal = afirmaVerificacionSinTool(segundo, herramientasUsadas.length > 0)
          ? "Nota: no pude verificarlo en vivo esta vez, así que tómalo como referencia, no como dato confirmado.\n\n" + segundo
          : segundo;
      }
    }

    // CP3/CP9 — Validador "prometió y no hizo" (caso Hector: "procedo a generar
    // los 15 PDF" x3, nunca llamó la herramienta). Si el texto ANUNCIA una acción
    // y el turno no ejecutó nada ejecutable (pdf/write), se repite la vuelta con
    // tool_choice:any; si aun así no actúa, se reemplaza el texto por uno honesto
    // y se registra como error_de_tool (no es una falta de capacidad, es de ejecución).
    if (prometioYNoHizo(respuestaFinal, huboAccionEjecutable, archivos.length)) {
      await supabase.from("assistant_acciones").insert({
        conversacion_id: convId, tool: "validador_promesa",
        params: { texto: respuestaFinal.slice(0, 200) }, ok: false,
        resumen: "anunció una acción sin ejecutarla → repetida con tool_choice:any",
      }).then(() => {}, () => {});
      messages.push({ role: "assistant", content: respuestaFinal });
      messages.push({ role: "user", content: "Dijiste que ibas a hacer algo (generar, preparar, enviar…) pero NO llamaste ninguna herramienta para hacerlo. Si de verdad puedes, LLAMA la herramienta AHORA en este turno. Si no puedes (falta un dato, no tienes la herramienta, etc.), dilo con claridad — nunca anuncies algo que no vas a ejecutar." });
      const tercero = await correrLoop(true);
      if (tercero && !prometioYNoHizo(tercero, huboAccionEjecutable, archivos.length)) {
        respuestaFinal = tercero;
      } else {
        respuestaFinal = "No pude generarlo — ya lo reporté a Tecnología. ¿Quieres que lo intente de otra forma?";
        await registrarNoAtendida("error_de_tool", null, "anunció una acción y no la ejecutó (validador_promesa)");
      }
    }
  } catch (e) {
    return json({ error: `El asistente tuvo un problema: ${e instanceof Error ? e.message : "desconocido"}` }, 502);
  }
  // BE2 — NUNCA una excusa vacía: si no hubo texto, el fallback lleva causa + salida.
  if (!respuestaFinal) {
    if (propuesta) respuestaFinal = propuesta.accion === "abrir"
      ? "Te dejé la echada preparada; ábrela abajo para agregar las fotos y guardarla."
      : "Preparé la acción; revísala y confírmala abajo.";
    else if (archivos.length) respuestaFinal = archivos.length > 1 ? "Tus archivos están listos para descargar abajo." : "Tu archivo está listo para descargar abajo.";
    else if (ultimoFallo?.motivo === "sin_permiso")
      respuestaFinal = "Eso no lo puedo ver con tu acceso actual. Si crees que deberías tenerlo, avísale a Tecnología — ya lo dejé anotado.";
    else if (ultimoFallo)
      respuestaFinal = "Esa consulta falló por un problema técnico y ya quedó reportada a Tecnología para arreglarla. ¿Quieres que intente otra cosa mientras tanto?";
    else {
      // Sin fallo de tool y sin texto: no entendí la intención. Lo registro como gap.
      respuestaFinal = "No terminé de agarrar qué necesitas. ¿Me lo dices de otra forma? Por ejemplo: \"¿dónde hay puntales?\", \"¿tengo conduces por firmar?\", o \"rutas de hoy\".";
      await registrarNoAtendida("sin_tool", null, "respuesta vacía sin fallo de herramienta");
    }
  }

  await supabase.from("assistant_mensajes").insert([
    { conversacion_id: convId, rol: "user", contenido: mensaje },
    { conversacion_id: convId, rol: "assistant", contenido: respuestaFinal, herramientas: herramientasUsadas },
  ]).then(() => {}, () => {});
  await supabase.from("assistant_conversaciones").update({ updated_at: new Date().toISOString() }).eq("id", convId).then(() => {}, () => {});

  return json({ conversacion_id: convId, respuesta: respuestaFinal, herramientas: herramientasUsadas, propuesta, archivos, archivo: archivos[0] ?? null });
});
