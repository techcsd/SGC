import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import * as XLSX from "npm:xlsx@0.18.5";

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
const MODEL = Deno.env.get("ASSISTANT_MODEL") ?? "claude-haiku-4-5-20251001";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_MSGS_HORA = 60;
const MAX_TOOL_LOOPS = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;
interface Cap { usuario_id: string; nombre: string; es_admin: boolean; modulos: string[]; roles: string[] }

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

interface ToolDef {
  name: string;
  description: string;
  modulos: string[] | null;
  input_schema: Record<string, unknown>;
  // AY11/C2 — genera un archivo PDF (se compone server-side y se entrega como
  // tarjeta descargable; hereda permisos: los datos salen de una consulta con RLS).
  pdf?: boolean;
  // AY C4 — memoria: guarda una preferencia del propio usuario (recordar_memoria).
  memoria?: boolean;
  // BE2 — "gap": no consulta ni actúa; registra que a Compa le FALTA una capacidad
  // (motivo sin_tool) para el backlog de Tecnología. Se resuelve en el loop.
  gap?: boolean;
  // Lectura:
  rpc?: string;
  map?: (i: Any) => Record<string, unknown>;
  // Escritura (v2): se PREPARA, no se ejecuta hasta la confirmación.
  write?: {
    tipo: string;
    execRpc: string;
    execMap: (p: Any, cap: Cap) => Record<string, unknown>;
  };
}

const TOOLS: ToolDef[] = [
  // ── LECTURA ──────────────────────────────────────────────────────────────
  {
    name: "buscar_articulos",
    description: "Busca artículos del catálogo por nombre o código, tolerante a errores de tecleo (fuzzy). Úsala para resolver el articulo_id que necesitan las requisiciones y los conduces. Devuelve una lista de candidatos ORDENADA por relevancia, cada uno con un 'score' (0-1) además de id, nombre, código y unidad. Regla de desambiguación: si un calificativo del usuario distingue claramente a un candidato (p. ej. la palabra que dio coincide con su nombre), asúmelo y anúncialo; solo pregunta si hay empate real de relevancia. Ejemplo: query='cemento gris'.",
    modulos: null,
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"], additionalProperties: false },
    rpc: "buscar_articulos",
    map: (i) => ({ p_query: String(i.query ?? ""), p_limit: Math.min(Number(i.limit ?? 15), 50) }),
  },
  {
    name: "mis_conduces_por_firmar",
    description: "Conduces que el usuario tiene pendientes de FIRMAR como despachante.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_por_firmar", map: () => ({}),
  },
  {
    name: "mis_conduces_pendientes_entrega",
    description: "Conduces que el usuario tiene pendientes de ENTREGAR / confirmar.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_pendientes_entrega", map: () => ({}),
  },
  {
    // AY-F1 🔴 seguridad: usa `mis_tareas_asistente` (filtro estricto por
    // identidad), NO `mis_tareas_app` (ese tiene escape de módulo/admin para el
    // tablero → devolvía tareas ajenas a cualquiera con el módulo `tareas`).
    name: "mis_tareas",
    description: "SOLO las tareas del propio usuario (asignadas a él o creadas por él). No es el tablero de tareas del equipo.",
    modulos: null,
    input_schema: { type: "object", properties: { incluir_completadas: { type: "boolean" } } },
    rpc: "mis_tareas_asistente", map: (i) => ({ p_incluir_completadas: !!i.incluir_completadas }),
  },
  {
    name: "mis_proyectos",
    description: "Proyectos/obras a los que el usuario tiene acceso. Devuelve su id, necesario para preparar tareas, requisiciones o conduces.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_proyectos", map: () => ({ p_usuario: null }),
  },
  {
    name: "mis_rutas_hoy",
    description: "Rutas de transporte del usuario para hoy.",
    modulos: null, input_schema: { type: "object", properties: {} },
    rpc: "mis_rutas_hoy", map: () => ({}),
  },
  {
    name: "buscar_usuarios",
    description: "Busca usuarios por nombre para obtener su id (p. ej. a quién asignar una tarea).",
    modulos: null,
    input_schema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
    rpc: "buscar_usuarios", map: (i) => ({ p_term: String(i.term ?? "") }),
  },
  {
    // AY9/C1 — identidad: qué accede el PROPIO usuario (módulos + submódulos +
    // roles). Para "¿tengo acceso a X?" con datos reales, no deducido del perfil.
    name: "mis_permisos",
    description: "Devuelve los accesos del PROPIO usuario: módulos, submódulos (con su nivel ver/operar) y roles. Úsala cuando el usuario pregunte '¿tengo acceso a X?', 'qué puedo hacer', o para verificar en vivo qué le permite el sistema en vez de deducirlo de su perfil. Devuelve solo lo suyo; nunca los permisos de otra persona. No incluye datos de negocio, solo el mapa de permisos.",
    modulos: null, input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_permisos", map: () => ({}),
  },
  {
    // BB4(5) — identidad EN VIVO: re-verifica con quién habla y qué día/hora es AHORA.
    name: "quien_soy",
    description: "Devuelve EN VIVO la identidad de la persona con la que hablas: su nombre, id de usuario, si es administrador, sus roles y módulos, y la fecha/hora actual en zona República Dominicana. Úsala cuando el usuario pregunte '¿quién soy?', '¿sabes con quién hablas?', '¿qué hora/día es?', o cuando necesites CONFIRMAR la identidad real antes de una acción (no la deduzcas del historial de la conversación, que puede venir de otra sesión). Es la fuente de verdad de identidad; solo la del usuario actual.",
    modulos: null, input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "quien_soy", map: () => ({}),
  },
  {
    // AY C3 — conocimiento: cómo funciona el sistema (corpus del módulo Dudas).
    name: "buscar_ayuda",
    description: "Busca en la ayuda/Dudas del sistema cómo hacer algo o qué significa un estado (p. ej. '¿cómo hago un conduce?', '¿qué es una requisición?'). Úsalo para preguntas de USO del sistema, no de datos.",
    modulos: null,
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    rpc: "buscar_ayuda", map: (i) => ({ p_query: String(i.query ?? "") }),
  },
  {
    // AY C4 — memoria: recuerda una preferencia del usuario entre conversaciones.
    name: "recordar",
    description: "Guarda una preferencia o dato operativo del usuario para recordarlo en futuras conversaciones (p. ej. su obra por defecto, formato preferido, a quién suele asignar). Es SOLO del propio usuario. Úsalo cuando el usuario diga 'recuerda que…' o exprese una preferencia estable.",
    modulos: null, memoria: true,
    input_schema: { type: "object", properties: { clave: { type: "string" }, valor: { type: "string" } }, required: ["clave", "valor"] },
  },
  {
    // AY11/C2 — genera un PDF descargable. Los datos salen de una consulta con
    // los permisos del usuario (hereda RLS): si no puede ver el dato, no hay PDF.
    name: "generar_reporte_pdf",
    description: "Genera un reporte descargable en PDF o Excel. Tipos: 'usuarios' (listado de usuarios, solo admin), 'stock_almacen' (existencias de un almacén — pide bodega_id con 'listar_almacenes'), 'desempeno_semana' (desempeño de choferes de la semana), 'conduces_dia' (conduces emitidos hoy). Usa formato 'excel' si el usuario pide Excel/hoja de cálculo; si no, PDF. El archivo hereda tus permisos. Tras generarlo, dile al usuario que su descarga está lista abajo.",
    modulos: null, pdf: true,
    input_schema: { type: "object", properties: {
      tipo: { type: "string", description: "usuarios | stock_almacen | desempeno_semana | conduces_dia" },
      formato: { type: "string", description: "pdf | excel (por defecto pdf)" },
      bodega_id: { type: "string" }, anio: { type: "integer" }, semana: { type: "integer" },
    }, required: ["tipo"] },
  },
  {
    name: "listar_almacenes",
    description: "Lista los almacenes/bodegas con su id y nombre, para usarlos como origen de un conduce o para consultar stock. Devuelve todos los almacenes visibles para el usuario. Regla de desambiguación (BB1): si el usuario nombró un calificativo que distingue a UN almacén (p. ej. dijo 'central' y existe 'Bodega Central'), asume ese y anúncialo ('Asumo Bodega Central — dime si era otro'); pregunta solo si dos o más almacenes encajan igual de bien con lo que dijo. Requiere el módulo inventario.",
    modulos: ["inventario"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "ubicaciones_almacen", map: () => ({ p_incluir_prueba: false }),
  },
  {
    name: "despachantes_disponibles",
    description: "Despachantes ELEGIBLES para firmar un conduce desde un almacén hacia una obra (regla de elegibilidad AV1).",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" }, proyecto_id: { type: "string" } } },
    rpc: "despachantes_disponibles", map: (i) => ({ p_bodega_id: i.bodega_id ?? null, p_proyecto_id: i.proyecto_id ?? null }),
  },
  {
    name: "requisiciones_pendientes",
    description: "Bandeja de requisiciones. Filtra por estado/urgencia/texto. Requiere inventario o compras.",
    modulos: ["inventario", "compras"],
    input_schema: { type: "object", properties: { estado: { type: "string" }, urgencia: { type: "string" }, busqueda: { type: "string" } } },
    rpc: "requisiciones_bandeja",
    map: (i) => ({ p_estado: i.estado ?? "pendiente", p_proyecto_id: null, p_urgencia: i.urgencia ?? null, p_busqueda: i.busqueda ?? null, p_limite: 30 }),
  },
  {
    name: "resumen_proyectos",
    description: "KPIs/resumen de los proyectos. Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"], input_schema: { type: "object", properties: {} },
    rpc: "kpi_proyectos", map: () => ({}),
  },
  {
    name: "log_combustible",
    description: "Echadas de combustible recientes (galones, rendimiento). Requiere flota.",
    modulos: ["flota"],
    input_schema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
    rpc: "log_combustible", map: (i) => ({ p_desde: i.desde ?? null, p_hasta: i.hasta ?? null, p_vehiculo_id: null, p_usuario_id: null }),
  },

  // ── AY9/C1 — cobertura de lectura módulo por módulo ────────────────────────
  // Flota
  {
    name: "listar_vehiculos",
    description: "Lista los vehículos de la flota (placa, marca, modelo, año, activo). Para \"¿cuántos vehículos tenemos?\". Requiere flota.",
    modulos: ["flota"], input_schema: { type: "object", properties: {} },
    rpc: "flota_placas", map: () => ({}),
  },
  {
    name: "vehiculos_en_uso",
    description: "Vehículos actualmente EN USO (con quién, desde cuándo). Requiere flota.",
    modulos: ["flota"], input_schema: { type: "object", properties: {} },
    rpc: "vehiculos_en_uso", map: () => ({}),
  },
  {
    name: "resumen_flota",
    description: "Resumen/conteos de la flota (total, activos, en mantenimiento, en uso, mantenimientos pendientes). Requiere flota.",
    modulos: ["flota"], input_schema: { type: "object", properties: {} },
    rpc: "resumen_flota", map: () => ({}),
  },
  {
    name: "mantenimientos_pendientes",
    description: "Mantenimientos pendientes o en proceso de la flota. Requiere flota.",
    modulos: ["flota"], input_schema: { type: "object", properties: {} },
    rpc: "mantenimientos_pendientes", map: () => ({}),
  },
  // Inventario
  {
    name: "stock_por_almacen",
    description: "Existencias de un almacén/bodega (obtén el bodega_id con 'listar_almacenes'). Opcional: búsqueda por texto. Requiere inventario.",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" }, busqueda: { type: "string" } }, required: ["bodega_id"] },
    rpc: "inventario_almacen", map: (i) => ({ p_bodega_id: i.bodega_id, p_incluir_cero: false, p_busqueda: i.busqueda ?? null, p_incluir_catalogo: false }),
  },
  {
    name: "articulos_bajo_minimo",
    description: "Artículos por debajo de su stock mínimo en un almacén (obtén el bodega_id con 'listar_almacenes'). Requiere inventario.",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" } }, required: ["bodega_id"] },
    rpc: "articulos_bajo_minimo", map: (i) => ({ p_bodega_id: i.bodega_id }),
  },
  {
    name: "movimientos_recientes",
    description: "Últimos movimientos (entradas/salidas) de un artículo (obtén el articulo_id con 'buscar_articulos'). Requiere inventario.",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { articulo_id: { type: "string" }, limit: { type: "integer" } }, required: ["articulo_id"] },
    rpc: "ultimos_movimientos_articulo", map: (i) => ({ p_articulo_id: i.articulo_id, p_limit: Math.min(Number(i.limit ?? 10), 50) }),
  },
  {
    // BG4 — material dañado / en cuarentena (no despachable). "¿cuánto material
    // dañado hay en Bodega Central?". Solo muestra almacenes visibles al rol.
    name: "material_en_cuarentena",
    description: "Material DAÑADO en cuarentena (retirado, NO despachable) por almacén. Úsala para '¿cuánto material dañado hay?', '¿qué hay en cuarentena en Bodega Central?'. Opcional: filtro por texto (artículo o almacén). Solo muestra los almacenes que tu rol puede ver. Requiere inventario.",
    modulos: ["inventario"],
    input_schema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
    rpc: "material_en_cuarentena", map: (i) => ({ p_query: i.query ?? null }),
  },
  // Incentivo (roles autorizados — puede_gestionar_incentivos)
  {
    name: "desempeno_semana",
    description: "Desempeño/incentivo de choferes de una semana ISO (por defecto la semana actual). Solo roles autorizados. Requiere módulo incentivos.",
    modulos: ["incentivos"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } } },
    rpc: "desempeno_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  // Proyectos (ficha = resumen_proyectos, ya existe arriba)
  {
    name: "cronograma_de_obra",
    description: "Cronograma (Gantt) de una obra: tareas, avance, dependencias (obtén el proyecto_id con 'mis_proyectos'). Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"],
    input_schema: { type: "object", properties: { proyecto_id: { type: "string" } }, required: ["proyecto_id"] },
    rpc: "listar_cronograma", map: (i) => ({ p_proyecto_id: i.proyecto_id }),
  },
  {
    name: "personal_de_obra",
    description: "Conteo del personal de una obra (total, por cargo, por nacionalidad) (obtén el proyecto_id con 'mis_proyectos'). Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"],
    input_schema: { type: "object", properties: { proyecto_id: { type: "string" } }, required: ["proyecto_id"] },
    rpc: "personal_obra_conteos", map: (i) => ({ p_proyecto_id: i.proyecto_id }),
  },
  {
    // BJ1 — cobertura de bitácoras por obra (pedido de Eduardo NG por WhatsApp).
    name: "cobertura_de_bitacoras",
    description: "Reporte de cuántas bitácoras hay POR OBRA, con su última fecha y su estado (al día / atrasada / SIN bitácoras). Úsala para '¿cuántas bitácoras hay por obra?', '¿qué obras están al día con la bitácora?', '¿qué obras no han hecho bitácora?', 'reporte de bitácoras por obra para los ingenieros'. Devuelve TODAS las obras activas, incluidas las que tienen 0 (que son las que hay que atender). Por defecto cuenta todo el histórico; pasa desde/hasta (YYYY-MM-DD) para acotar un rango. Requiere módulo bitácora, proyectos o dirección.",
    modulos: ["bitacora", "proyectos", "direccion"],
    input_schema: { type: "object", properties: {
      desde: { type: "string", description: "YYYY-MM-DD (opcional; por defecto todo el histórico)" },
      hasta: { type: "string", description: "YYYY-MM-DD (opcional)" },
    }, additionalProperties: false },
    rpc: "bitacoras_cobertura_resumen", map: (i) => ({ p_desde: i.desde ?? null, p_hasta: i.hasta ?? null }),
  },

  // ── BE2 — Consultas por rol (los 3 gaps de las capturas) ──────────────────
  {
    // BE2(1) — "¿qué hizo hoy Misael?". Gate en el RPC: cualquiera ve LO SUYO;
    // la actividad de OTRA persona exige supervisión operativa (admin/dirección/
    // gerencia/logística/jefe de flota). Un chofer NO ve la de otro chofer.
    name: "actividad_de_usuario",
    description: "Resumen de la actividad de UN usuario en un día: rutas conducidas, conduces emitidos, echadas de combustible y bitácoras. Úsala para '¿qué hizo hoy <persona>?' o '¿qué he hecho yo hoy?'. Para la actividad de OTRA persona necesitas su usuario_id (resuélvelo con 'buscar_usuarios'); para la tuya, deja usuario_id vacío. Devuelve conteos y un detalle corto por dominio, no el volcado completo. Respeta el rol: si no tienes permiso para ver a esa persona, la herramienta lo dirá y no debes insistir. La fecha por defecto es hoy (zona República Dominicana); pásala como YYYY-MM-DD para otro día.",
    modulos: null,
    input_schema: { type: "object", properties: {
      usuario_id: { type: "string", description: "usuario_id de la persona (de buscar_usuarios); vacío = tú mismo" },
      fecha: { type: "string", description: "YYYY-MM-DD (por defecto hoy)" },
    }, additionalProperties: false },
    rpc: "actividad_de_usuario", map: (i) => ({ p_usuario_id: i.usuario_id ?? null, p_fecha: i.fecha ?? null }),
  },
  {
    // BE2(2) — panorama de rutas del día. Supervisión = TODAS; el resto = las suyas.
    // Misma fuente que Seguimiento / Panel del día (AU1). Complementa 'mis_rutas_hoy'.
    name: "rutas_del_dia",
    description: "Panorama de las rutas de transporte de un día, con su estado. Si eres de logística, jefe de flota, gerencia o admin, devuelve TODAS las rutas del día (el panorama global que antes había que pedirle a logística); si no, devuelve solo las tuyas. Úsala para 'resumen de todas las rutas de hoy', '¿cómo van las rutas?', '¿cuántas rutas hay hoy?'. Devuelve el total, un desglose por estado y la lista con conductor, vehículo y estado. Es la misma data del módulo de Seguimiento. La fecha por defecto es hoy (zona República Dominicana).",
    modulos: null,
    input_schema: { type: "object", properties: {
      fecha: { type: "string", description: "YYYY-MM-DD (por defecto hoy)" },
    }, additionalProperties: false },
    rpc: "rutas_del_dia", map: (i) => ({ p_fecha: i.fecha ?? null }),
  },
  {
    // BE2(3) — la consulta estrella de obra: "¿dónde hay puntales?". Resuelve por
    // apodo (AU12) y devuelve dónde hay stock, filtrado por bodegas visibles al rol.
    name: "disponibilidad_de_articulo",
    description: "Dice DÓNDE hay existencia de un artículo: en qué almacenes y obras hay stock y cuánto. Úsala para '¿en qué almacenes o proyectos hay puntales?', '¿dónde hay cemento?', '¿tenemos X disponible?'. Resuelve el término por nombre, código o APODO (p. ej. 'puntales' puede ser un alias). Si el término coincide con varios artículos, devuelve los candidatos para que preguntes cuál; entonces vuelve a llamarla con 'articulo_id'. Solo muestra los almacenes que tu rol puede ver (si no tienes acceso a inventario, no verá existencias).",
    modulos: null,
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "nombre, código o apodo del artículo (p. ej. 'puntales')" },
      articulo_id: { type: "string", description: "id exacto si ya lo resolviste (de buscar_articulos)" },
    }, additionalProperties: false },
    rpc: "disponibilidad_de_articulo", map: (i) => ({ p_query: i.query ?? null, p_articulo_id: i.articulo_id ?? null }),
  },
  {
    // BE2 — el backlog automático: cuando a Compa le falta una capacidad, la registra
    // (motivo sin_tool) para que Tecnología la construya. Sustituye las capturas a mano.
    name: "reportar_gap",
    description: "Regístrala cuando el usuario te pide algo para lo que NO tienes ninguna herramienta (no cuando una herramienta falla, eso ya se registra solo). Anota que a Compa le falta esa capacidad para que Tecnología la construya después. Llámala ANTES de disculparte, y luego dile al usuario con honestidad qué no puedes todavía y qué SÍ puedes ofrecerle como alternativa. No la uses para consultas que sí puedes resolver.",
    modulos: null, gap: true,
    input_schema: { type: "object", properties: {
      tema: { type: "string", description: "en pocas palabras, qué capacidad falta (p. ej. 'ver el historial de precios de un artículo')" },
    }, required: ["tema"], additionalProperties: false },
  },

  // ── BE1 — Reportes semanales (misma RPC que compone el correo del lunes) ───
  {
    // BE1(1) — requisiciones por obra × ingeniero. Preguntable cualquier día.
    name: "resumen_requisiciones_semana",
    description: "Resumen semanal de requisiciones: cuántas se crearon, por obra y por ingeniero solicitante, con el total. Úsala para '¿cuántas requisiciones hizo Torre Alpha esta semana?', '¿quién pidió más material?'. Por defecto la última semana cerrada (lunes-domingo); pasa anio + semana ISO para otra. Es la misma data del reporte del correo del lunes. Requiere módulo inventario, compras o dirección.",
    modulos: ["inventario", "compras", "direccion"],
    input_schema: { type: "object", properties: {
      anio: { type: "integer" }, semana: { type: "integer", description: "semana ISO" },
    }, additionalProperties: false },
    rpc: "resumen_requisiciones_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(2) — estatus/embudo + pendientes por atender con su edad.
    name: "resumen_estatus_requisiciones",
    description: "Estatus semanal de las requisiciones: el embudo (creadas, pendientes, aprobadas, despachadas parcial/total, canceladas) y la LISTA de pendientes por atender con su antigüedad ('REQ-000123 · Torre Alpha · 4 días esperando'). Úsala para '¿qué requisiciones están atascadas?', '¿qué falta por despachar?', '¿se atendieron todas?'. Por defecto la última semana cerrada; pasa anio + semana ISO para otra. Requiere módulo inventario, compras o dirección.",
    modulos: ["inventario", "compras", "direccion"],
    input_schema: { type: "object", properties: {
      anio: { type: "integer" }, semana: { type: "integer", description: "semana ISO" },
    }, additionalProperties: false },
    rpc: "resumen_estatus_requisiciones", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(3) — rutas hechas por chofer; cuarentena BB8 aparte.
    name: "resumen_rutas_semana",
    description: "Resumen semanal de rutas completadas: por chofer y total. Las 'en revisión' (rutas completadas sin km/tiempo trackeado — cuarentena BB8) se cuentan APARTE, no se mezclan. Úsala para '¿cuántas rutas se hicieron esta semana?', '¿quién hizo más rutas?'. Por defecto la última semana cerrada. Requiere módulo flota o dirección.",
    modulos: ["flota", "direccion"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_rutas_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(4) — conduces emitidos por tipo y obra destino.
    name: "resumen_conduces_semana",
    description: "Resumen semanal de conduces emitidos: por tipo (normal / externo) y por obra destino, con el total. Úsala para '¿cuántos conduces se hicieron?', '¿a qué obra fueron más conduces?'. Por defecto la última semana cerrada. Requiere módulo inventario o dirección.",
    modulos: ["inventario", "direccion"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_conduces_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(5) — movimiento de inventario por almacén.
    name: "resumen_inventario_semana",
    description: "Resumen semanal del movimiento de inventario por almacén: entradas, salidas y ajustes de la semana. Úsala para '¿cuánto movimiento hubo en el almacén X?', '¿qué almacén tuvo más entradas?'. Por defecto la última semana cerrada. Requiere módulo inventario o dirección.",
    modulos: ["inventario", "direccion"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_inventario_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(6) — km + combustible de vehículos de carga (solo echadas válidas AW3).
    name: "resumen_flota_carga_semana",
    description: "Resumen semanal de los vehículos de CARGA (camiones): km recorridos, galones echados (solo echadas válidas, las corregidas no cuentan) y costo, por vehículo. Úsala para '¿cuánto combustible gastaron los camiones?', '¿cuántos km hicieron?'. Avisa si el km está en depuración (echadas sin odómetro). Por defecto la última semana cerrada. Requiere módulo flota o dirección.",
    modulos: ["flota", "direccion"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_flota_carga_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(7) — bitácoras por obra vs días laborables (el "quién no está llenando").
    name: "resumen_bitacoras_semana",
    description: "Resumen semanal de bitácoras por obra: cuántos días de la semana tuvieron bitácora vs los días laborables ('Torre Alpha: 5/6 días'). Muestra las obras activas SIN bitácora — el 'quién no está llenando'. Úsala para '¿qué obras no están llenando la bitácora?', '¿cuántas bitácoras hubo?'. Por defecto la última semana cerrada. Requiere módulo bitacora, proyectos o dirección.",
    modulos: ["bitacora", "proyectos", "direccion"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_bitacoras_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },

  // ── ESCRITURA (v2: preparar → confirmar → ejecutar) ────────────────────────
  {
    name: "proponer_tarea",
    description: "PREPARA (borrador, NO crea) una tarea para asignar a alguien en una obra. Resuelve el proyecto_id con 'mis_proyectos' y, si se asigna a otra persona, su usuario_id con 'buscar_usuarios'. Si falta el título o la obra, pregúntalos. Al llamarla el sistema muestra una tarjeta para CONFIRMAR; hasta entonces la tarea NO existe. Requiere módulo tareas.",
    modulos: ["tareas"],
    input_schema: {
      type: "object",
      properties: {
        proyecto_id: { type: "string" }, titulo: { type: "string" }, descripcion: { type: "string" },
        asignado_a: { type: "string", description: "usuario_id de a quién se asigna (opcional)" },
        prioridad: { type: "string", description: "alta | media | baja" },
        fecha_limite: { type: "string", description: "YYYY-MM-DD (opcional)" },
      }, required: ["proyecto_id", "titulo"],
    },
    write: {
      tipo: "tarea", execRpc: "asignar_tarea_obra",
      execMap: (p) => ({ p_id: null, p_proyecto_id: p.proyecto_id, p_titulo: p.titulo, p_descripcion: p.descripcion ?? null, p_asignado_a: p.asignado_a ?? null, p_brigada: null, p_prioridad: p.prioridad ?? "media", p_fecha_limite: p.fecha_limite ?? null }),
    },
  },
  {
    name: "proponer_requisicion",
    description: "PREPARA (borrador, NO crea) una requisición de material para una obra. Resuelve el proyecto_id con 'mis_proyectos' y el articulo_id de cada ítem con 'buscar_articulos'. Si el usuario no dio los ítems o cantidades, PREGÚNTALOS antes de proponer. Al llamarla el sistema muestra una tarjeta para CONFIRMAR; hasta entonces la requisición NO existe y NO está enviada a aprobación. Requiere módulo inventario o compras.",
    modulos: ["inventario", "compras"],
    input_schema: {
      type: "object",
      properties: {
        proyecto_id: { type: "string" }, urgencia: { type: "string", description: "alta | media | baja" }, notas: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { articulo_id: { type: "string" }, cantidad: { type: "number" }, unidad: { type: "string" } }, required: ["articulo_id", "cantidad"] } },
      }, required: ["proyecto_id", "items"],
    },
    write: {
      tipo: "requisicion", execRpc: "crear_solicitud_material",
      execMap: (p, cap) => ({ p_proyecto_id: p.proyecto_id, p_solicitante_id: cap.usuario_id, p_urgencia: p.urgencia ?? "media", p_notas: p.notas ?? null, p_items: (p.items ?? []).map((it: Any) => ({ articulo_id: it.articulo_id, descripcion: null, cantidad: it.cantidad, unidad: it.unidad ?? null, talla: null })) }),
    },
  },
  {
    name: "proponer_conduce",
    description: "PREPARA (borrador, NO crea) un conduce/salida de material desde un almacén hacia una obra. Resuelve primero: el almacén de origen con 'listar_almacenes', la obra de destino con 'mis_proyectos', y el articulo_id de cada ítem con 'buscar_articulos'. Opcionales: vehículo y despachante elegible ('despachantes_disponibles'). Si el usuario no dio los ítems o cantidades, PREGÚNTALOS antes de proponer. Al llamarla, el sistema muestra una tarjeta para que el usuario CONFIRME; hasta entonces el conduce NO existe. No la llames dos veces para el mismo movimiento: un borrador idéntico se reutiliza y confirmar produce UN solo conduce. Requiere módulo inventario. Ejemplo de items: [{articulo_id:'…', cantidad:10}].",
    modulos: ["inventario"],
    input_schema: {
      type: "object",
      properties: {
        bodega_id: { type: "string", description: "almacén de origen (de listar_almacenes)" },
        proyecto_id: { type: "string", description: "obra de destino (de mis_proyectos)" },
        vehiculo_id: { type: "string" }, observaciones: { type: "string" },
        despachante_usuario_id: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { articulo_id: { type: "string" }, cantidad: { type: "number" } }, required: ["articulo_id", "cantidad"], additionalProperties: false } },
      }, required: ["bodega_id", "proyecto_id", "items"], additionalProperties: false,
    },
    write: {
      tipo: "conduce", execRpc: "crear_conduce_simple",
      execMap: (p) => ({ p_id: p.__idem_id ?? crypto.randomUUID(), p_fecha: new Date().toISOString().slice(0, 10), p_bodega_id: p.bodega_id, p_proyecto_id: p.proyecto_id, p_observaciones: p.observaciones ?? null, p_vehiculo_id: p.vehiculo_id ?? null, p_ruta_id: null, p_items: (p.items ?? []).map((it: Any) => ({ articulo_id: it.articulo_id, cantidad: it.cantidad })), p_despachante_nombre: null, p_despachante_usuario_id: p.despachante_usuario_id ?? null, p_despachante_empleado_id: null, p_carga_foto_path: null, p_firma_chofer_path: null, p_firma_despachante_path: null }),
    },
  },
  {
    // BB3(d) — "asígnaselo a Papo": crea la ruta de Flota (chofer + vehículo), como
    // borrador+confirmación. Puede vincular un conduce ya creado (Transporte v3 / BA6).
    name: "proponer_ruta",
    description: "PREPARA (borrador, NO crea) una ruta de Flota: asigna un chofer y un vehículo para mover material/equipo, opcionalmente vinculada a un conduce ya existente. Úsala cuando el usuario diga 'asígnaselo a <chofer>', 'que <chofer> lleve esto', o pida crear una ruta. Resuelve el chofer con 'buscar_usuarios' (necesitas su usuario_id; debe ser un chofer activo) y el vehículo/obra con las herramientas correspondientes. El conduce NO tiene campo de chofer — el chofer vive en la ruta, por eso esta herramienta lo completa. Al llamarla el sistema muestra una tarjeta para CONFIRMAR; hasta entonces la ruta NO existe. Requiere módulo flota. Ejemplo: conductor_usuario_id='…', vehiculo_id='…', conduce_id='…'.",
    modulos: ["flota"],
    input_schema: {
      type: "object",
      properties: {
        conductor_usuario_id: { type: "string", description: "usuario_id del chofer (de buscar_usuarios); debe ser chofer activo" },
        vehiculo_id: { type: "string", description: "vehículo de la ruta (obligatorio)" },
        conduce_id: { type: "string", description: "id del conduce a vincular (opcional)" },
        proyecto_id: { type: "string", description: "obra de destino (opcional)" },
        tipo: { type: "string", description: "material | personal | otro (por defecto material)" },
        origen: { type: "string" }, destino: { type: "string" },
        fecha: { type: "string", description: "YYYY-MM-DD (por defecto hoy)" },
      }, required: ["conductor_usuario_id", "vehiculo_id"], additionalProperties: false,
    },
    write: {
      tipo: "ruta", execRpc: "asistente_crear_ruta",
      execMap: (p) => ({ p_id: p.__idem_id ?? crypto.randomUUID(), p_conductor_usuario_id: p.conductor_usuario_id, p_vehiculo_id: p.vehiculo_id, p_tipo: p.tipo ?? "material", p_conduce_id: p.conduce_id ?? null, p_proyecto_id: p.proyecto_id ?? null, p_origen: p.origen ?? null, p_destino: p.destino ?? null, p_fecha: p.fecha ?? null }),
    },
  },
];

function toolsParaUsuario(cap: Cap): ToolDef[] {
  return TOOLS.filter((t) => t.modulos === null || cap.es_admin || t.modulos.some((m) => cap.modulos.includes(m)));
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
  "- GENERAR archivos (PDF/Excel) con 'generar_reporte_pdf' — aparecen como tarjeta descargable.",
  "- Explicar CÓMO funciona el sistema con 'buscar_ayuda' (usa esto para preguntas de uso, no de datos).",
  "- RECORDAR preferencias del usuario con 'recordar' (obra por defecto, formato, etc.).",
  "- Ver la ACTIVIDAD del día de una persona con 'actividad_de_usuario' (la tuya siempre; la de otro solo si tu rol te lo permite — la herramienta lo controla).",
  "- Ver las RUTAS del día con 'rutas_del_dia' (todas si eres logística/jefe de flota/gerencia/admin; si no, las tuyas).",
  "- Decir DÓNDE hay existencia de un artículo con 'disponibilidad_de_articulo' (resuelve apodos; muestra solo los almacenes que tu rol ve).",
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
  "",
  "NUNCA UNA EXCUSA VACÍA (BE2 — regla dura):",
  "12. PROHIBIDO responder \"No pude completar la consulta, intenta reformular\" o cualquier disculpa sin contenido. TODO fallo lleva CAUSA + SALIDA: di POR QUÉ falló y ofrece el SIGUIENTE PASO. Ejemplos: \"no encontré el artículo 'puntales' — ¿se llama distinto? puedo buscarlo por apodo\"; \"esa consulta de stock falló, ya la reporté a Tecnología — ¿quieres que intente otra cosa?\"; \"eso no lo puedo ver con tu acceso actual\".",
  "13. Si el usuario te pide algo para lo que NO tienes ninguna herramienta, PRIMERO llama 'reportar_gap' (para que Tecnología construya esa capacidad) y LUEGO dile con honestidad qué no puedes todavía y qué SÍ le ofreces. No inventes un rodeo para fingir que lo resolviste.",
  "14. Si una herramienta te devuelve un error o 'no tengo acceso', no lo escondas: explícale al usuario qué pasó en una frase (el sistema ya lo registró para Tecnología) y ofrécele una alternativa.",
].join("\n");

function bloqueIdentidad(cap: Cap, ahoraRD: string): string {
  return [
    "PERFIL (dato inicial de ESTA persona, NO es una consulta que hiciste):",
    `- Hablas con: ${cap.nombre}${cap.es_admin ? " (administrador)" : ""}.`,
    `- Rol(es): ${cap.roles.length ? cap.roles.join(", ") : "sin rol asignado"}.`,
    `- TRATO: ${tratamientoDeRoles(cap.roles)} Sé consistente con este trato en cada respuesta, saludos incluidos.`,
    `- Módulos con acceso: ${cap.modulos.length ? cap.modulos.join(", ") : "ninguno especial"}.`,
    `- Fecha y hora actual (República Dominicana): ${ahoraRD}.`,
    "Si dudas de con quién hablas o del día/hora, usa 'quien_soy' (no lo deduzcas del historial: puede venir de otra sesión).",
    "Cuando el usuario diga \"mis\", \"mi obra\", \"mi vehículo\", usa las herramientas 'mis_*'.",
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
  const body: Any = { model: MODEL, max_tokens: 1400, system, tools, messages };
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

// BB3 — Clave de idempotencia determinística por INTENCIÓN de acción: dos propuestas
// idénticas (mismo tipo + mismos parámetros esenciales) producen la MISMA clave → el
// branch CONFIRMAR deduplica y sale UN solo documento. Estable entre preparar y confirmar.
function claveIdem(usuarioId: string, tipo: string, params: Any): string {
  const esenciales: Any = { tipo, u: usuarioId };
  if (tipo === "conduce") {
    esenciales.b = params.bodega_id; esenciales.p = params.proyecto_id;
    esenciales.i = (params.items ?? []).map((it: Any) => `${it.articulo_id}:${it.cantidad}`).sort();
  } else if (tipo === "requisicion") {
    esenciales.p = params.proyecto_id;
    esenciales.i = (params.items ?? []).map((it: Any) => `${it.articulo_id}:${it.cantidad}`).sort();
  } else if (tipo === "tarea") {
    esenciales.p = params.proyecto_id; esenciales.t = (params.titulo ?? "").trim().toLowerCase(); esenciales.a = params.asignado_a ?? null;
  } else if (tipo === "ruta") {
    esenciales.c = params.conductor_usuario_id; esenciales.v = params.vehiculo_id; esenciales.cd = params.conduce_id ?? null; esenciales.p = params.proyecto_id ?? null;
  }
  // Hash corto y estable (djb2) → hex, prefijado por tipo para legibilidad.
  const s = JSON.stringify(esenciales);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${tipo}_${h.toString(16)}`;
}

// UUID determinístico a partir de la clave idem (para reusar el mismo p_id entre
// confirmaciones de la misma propuesta → la RPC ya es idempotente por id).
function idemUuid(clave: string): string {
  let h = 2166136261 >>> 0;
  const bytes: number[] = [];
  for (let k = 0; k < 16; k++) {
    for (let i = 0; i < clave.length; i++) { h ^= clave.charCodeAt(i) + k; h = Math.imul(h, 16777619) >>> 0; }
    bytes.push(h & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

// Compone un PDF tabular sencillo (multipágina) con pdf-lib.
async function componerPdf(titulo: string, subtitulo: string, cols: string[], rows: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40; // A4 portrait
  const gray = rgb(0.4, 0.4, 0.4), black = rgb(0.1, 0.1, 0.1);
  const colW = (W - 2 * M) / cols.length;
  const clip = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + "…" : t);
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);
  if (!ANTHROPIC_API_KEY) return json({ error: "El asistente no está configurado todavía (falta la API key). Avísale a Tecnología." }, 503);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "sgc" }, global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Sesión inválida" }, 401);

  let payload: { conversacion_id?: string; mensaje?: string; ejecutar?: Any };
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }

  // Capacidades del usuario.
  const { data: cap, error: capErr } = await supabase.rpc("capacidades_asistente");
  if (capErr || !cap) return json({ error: "No pude leer tus permisos." }, 500);
  const modulos: string[] = Array.isArray(cap.modulos) ? cap.modulos : [];
  const roles: string[] = Array.isArray(cap.roles) ? cap.roles : [];
  const capObj: Cap = { usuario_id: cap.usuario_id, nombre: cap.nombre ?? "Usuario", es_admin: !!cap.es_admin, modulos, roles };

  // ── Branch CONFIRMAR: ejecuta la acción preparada (mismo RPC del flujo normal) ──
  if (payload.ejecutar) {
    const prop = payload.ejecutar;
    const convId = payload.conversacion_id ?? null;
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
  const tools = disponibles.map((t, idx) => ({
    name: t.name,
    description: t.description,
    input_schema: { additionalProperties: false, ...t.input_schema },
    ...(idx === disponibles.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));

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
    { type: "text", text: bloqueIdentidad(capObj, ahoraRD()) + memText },
  ];
  const debeForzarTool = fuerzaHerramienta(mensaje);

  const herramientasUsadas: { tool: string; ok: boolean }[] = [];
  let propuesta: Any = null;
  let archivo: { nombre: string; url: string } | null = null;
  let respuestaFinal = "";
  // BE2 — último fallo de herramienta (para el mensaje de causa+salida sin excusa vacía).
  let ultimoFallo: { motivo: "sin_permiso" | "error_de_tool"; tool: string } | null = null;

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
      const forceThis = loop === 0 && forzarPrimera ? { type: "any" } : undefined;
      const resp = await callClaude(system, tools, messages, forceThis);
      const content: Any[] = resp.content ?? [];
      if (resp.stop_reason === "tool_use") {
        const results: Any[] = [];
        for (const block of content.filter((b) => b.type === "tool_use")) {
          const cfg = disponibles.find((t) => t.name === block.name);
          let out: unknown; let ok = false; let resumen = "";
          if (!cfg) {
            out = { error: "Herramienta no disponible." };
          } else if (cfg.gap) {
            // BE2 — Compa declara que le falta una capacidad → al backlog (sin_tool).
            try {
              const inp = block.input ?? {};
              await registrarNoAtendida("sin_tool", null, String(inp.tema ?? ""));
              out = { registrado: true, instruccion: "Ya quedó anotado para Tecnología. Ahora dile al usuario con honestidad qué NO puedes hacer todavía y ofrécele una alternativa concreta de lo que SÍ puedes. Nada de excusas vacías." };
              ok = true; resumen = `gap: ${String(inp.tema ?? "").slice(0, 60)}`;
            } catch (e) { out = { error: "No pude registrar el gap." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
          } else if (cfg.memoria) {
            // AY C4 — guarda una preferencia del propio usuario (escritura benigna, sin tarjeta).
            try {
              const inp = block.input ?? {};
              const { error } = await supabase.rpc("recordar_memoria", { p_clave: String(inp.clave ?? ""), p_valor: String(inp.valor ?? "") });
              if (error) { out = { error: "No pude guardar eso." }; resumen = error.message.slice(0, 200); }
              else { out = { guardado: true }; ok = true; resumen = `memoria: ${String(inp.clave ?? "").slice(0, 60)}`; }
            } catch (e) { out = { error: "No pude guardar eso." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
          } else if (cfg.pdf) {
            // AY11/C2 — genera un PDF con datos consultados con el JWT del usuario.
            try {
              const inp = block.input ?? {};
              const datos = await datosReporte(supabase, String(inp.tipo ?? ""), inp);
              if (!datos) {
                out = { error: "No hay datos para ese reporte o no tienes acceso." };
                resumen = "reporte sin datos/permiso";
              } else {
                const esExcel = String(inp.formato ?? "pdf").toLowerCase() === "excel";
                const fecha = new Date().toISOString().slice(0, 16).replace("T", " ");
                const bytes = esExcel
                  ? componerExcel(datos.titulo, datos.cols, datos.rows)
                  : await componerPdf(datos.titulo, `Generado por ${capObj.nombre} · ${fecha}`, datos.cols, datos.rows);
                const ext = esExcel ? "xlsx" : "pdf";
                const ctype = esExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
                const path = `${capObj.usuario_id}/${crypto.randomUUID()}.${ext}`;
                const { error: upErr } = await supabase.storage.from("reportes").upload(path, bytes, { contentType: ctype });
                if (upErr) { out = { error: "No se pudo guardar el archivo." }; resumen = upErr.message.slice(0, 200); }
                else {
                  const { data: signed } = await supabase.storage.from("reportes").createSignedUrl(path, 3600);
                  const nombre = `${datos.titulo}.${ext}`;
                  archivo = { nombre, url: signed?.signedUrl ?? "" };
                  out = { generado: true, nombre, filas: datos.rows.length, instruccion: "Dile al usuario que su archivo está listo para descargar en la tarjeta de abajo." };
                  ok = true; resumen = `${ext} ${datos.rows.length} filas`;
                }
              }
            } catch (e) { out = { error: "No se pudo generar el PDF." }; resumen = (e instanceof Error ? e.message : "error").slice(0, 200); }
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
            } catch (e) {
              out = { error: "No pude preparar la acción." };
              resumen = (e instanceof Error ? e.message : "error").slice(0, 200);
            }
          } else {
            // Lectura.
            try {
              const { data, error } = await supabase.rpc(cfg.rpc!, cfg.map!(block.input ?? {}));
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
  } catch (e) {
    return json({ error: `El asistente tuvo un problema: ${e instanceof Error ? e.message : "desconocido"}` }, 502);
  }
  // BE2 — NUNCA una excusa vacía: si no hubo texto, el fallback lleva causa + salida.
  if (!respuestaFinal) {
    if (propuesta) respuestaFinal = "Preparé la acción; revísala y confírmala abajo.";
    else if (archivo) respuestaFinal = "Tu archivo está listo para descargar abajo.";
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

  return json({ conversacion_id: convId, respuesta: respuestaFinal, herramientas: herramientasUsadas, propuesta, archivo });
});
