// ============================================================================
// CR1 (FASE 1) — Registro ÚNICO de herramientas, compartido por Compa
// (supabase/functions/assistant) y el servidor MCP (supabase/functions/mcp).
//
// Extraído de assistant/index.ts SIN cambiar su comportamiento (misma lista de
// herramientas por rol, mismas descripciones/schemas, mismo claveIdem). Lo que
// necesita código propio del edge (generar PDF, memoria, el matching de gaps,
// la búsqueda web nativa de Anthropic) se QUEDA en assistant/index.ts — aquí
// solo vive el REGISTRO (qué herramientas existen, su schema, su RPC) y lo que
// de verdad es genérico entre los dos servidores.
//
// `canales` marca dónde se ofrece cada herramienta: 'compa' (el asistente
// conversacional) y/o 'mcp' (el conector de Claude Desktop, CONTEXTO-51 §B1).
// Una herramienta con canales:['compa'] sigue existiendo para Compa igual que
// siempre; MCP (FASE 3) simplemente no la lista.
// ============================================================================

// deno-lint-ignore no-explicit-any
export type Any = any;

export interface Cap { usuario_id: string; nombre: string; es_admin: boolean; modulos: string[]; roles: string[] }

export interface ToolDef {
  name: string;
  description: string;
  modulos: string[] | null;
  input_schema: Record<string, unknown>;
  // Dónde se ofrece esta herramienta (CR1 §B1).
  canales: ("compa" | "mcp")[];
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

export const TOOLS: ToolDef[] = [
  // ── LECTURA ──────────────────────────────────────────────────────────────
  {
    name: "buscar_articulos",
    description: "Busca artículos del catálogo por nombre o código, tolerante a errores de tecleo (fuzzy). Úsala para resolver el articulo_id que necesitan las requisiciones y los conduces. Devuelve una lista de candidatos ORDENADA por relevancia, cada uno con un 'score' (0-1) además de id, nombre, código y unidad. Regla de desambiguación: si un calificativo del usuario distingue claramente a un candidato (p. ej. la palabra que dio coincide con su nombre), asúmelo y anúncialo; solo pregunta si hay empate real de relevancia. Ejemplo: query='cemento gris'.",
    modulos: null,
    canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"], additionalProperties: false },
    rpc: "buscar_articulos",
    map: (i) => ({ p_query: String(i.query ?? ""), p_limit: Math.min(Number(i.limit ?? 15), 50) }),
  },
  {
    name: "mis_conduces_por_firmar",
    description: "Conduces que el usuario tiene pendientes de FIRMAR como despachante.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_por_firmar", map: () => ({}),
  },
  {
    name: "mis_conduces_pendientes_entrega",
    description: "Conduces que el usuario tiene pendientes de ENTREGAR / confirmar.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "mis_conduces_pendientes_entrega", map: () => ({}),
  },
  {
    // AY-F1 🔴 seguridad: usa `mis_tareas_asistente` (filtro estricto por
    // identidad), NO `mis_tareas_app` (ese tiene escape de módulo/admin para el
    // tablero → devolvía tareas ajenas a cualquiera con el módulo `tareas`).
    name: "mis_tareas",
    description: "SOLO las tareas del propio usuario (asignadas a él o creadas por él). No es el tablero de tareas del equipo.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { incluir_completadas: { type: "boolean" } } },
    rpc: "mis_tareas_asistente", map: (i) => ({ p_incluir_completadas: !!i.incluir_completadas }),
  },
  {
    name: "mis_proyectos",
    description: "Proyectos/obras a los que el usuario tiene acceso. Devuelve su id, necesario para preparar tareas, requisiciones o conduces.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "mis_proyectos", map: () => ({ p_usuario: null }),
  },
  {
    name: "mis_rutas_hoy",
    description: "Rutas de transporte del usuario para hoy.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "mis_rutas_hoy", map: () => ({}),
  },
  {
    name: "buscar_usuarios",
    description: "Busca usuarios por nombre para obtener su id (p. ej. a quién asignar una tarea).",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
    rpc: "buscar_usuarios", map: (i) => ({ p_term: String(i.term ?? "") }),
  },
  {
    // AY9/C1 — identidad: qué accede el PROPIO usuario (módulos + submódulos +
    // roles). Para "¿tengo acceso a X?" con datos reales, no deducido del perfil.
    name: "mis_permisos",
    description: "Devuelve los accesos del PROPIO usuario: módulos, submódulos (con su nivel ver/operar) y roles. Úsala cuando el usuario pregunte '¿tengo acceso a X?', 'qué puedo hacer', o para verificar en vivo qué le permite el sistema en vez de deducirlo de su perfil. Devuelve solo lo suyo; nunca los permisos de otra persona. No incluye datos de negocio, solo el mapa de permisos.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_permisos", map: () => ({}),
  },
  {
    // BB4(5) — identidad EN VIVO: re-verifica con quién habla y qué día/hora es AHORA.
    name: "quien_soy",
    description: "Devuelve EN VIVO la identidad de la persona con la que hablas: su nombre, id de usuario, si es administrador, sus roles y módulos, y la fecha/hora actual en zona República Dominicana. Úsala cuando el usuario pregunte '¿quién soy?', '¿sabes con quién hablas?', '¿qué hora/día es?', o cuando necesites CONFIRMAR la identidad real antes de una acción (no la deduzcas del historial de la conversación, que puede venir de otra sesión). Es la fuente de verdad de identidad; solo la del usuario actual.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "quien_soy", map: () => ({}),
  },
  {
    // AY C3 — conocimiento: cómo funciona el sistema (corpus del módulo Dudas).
    name: "buscar_ayuda",
    description: "Busca en la ayuda/Dudas del sistema cómo hacer algo o qué significa un estado (p. ej. '¿cómo hago un conduce?', '¿qué es una requisición?'). Úsalo para preguntas de USO del sistema, no de datos.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    rpc: "buscar_ayuda", map: (i) => ({ p_query: String(i.query ?? "") }),
  },
  {
    // BQ10 — buscar una requisición por su folio (REQ-######) para llegar a su conduce.
    name: "buscar_folio",
    description: "Busca una requisición por su folio (p. ej. 'REQ-000040' o solo '40'). Devuelve el código, estado, obra y la ruta para abrirla. Úsala cuando el usuario dé un número de folio (REQ-...) y pregunte dónde está o cómo llegar a su conduce.",
    modulos: ["inventario", "compras"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { folio: { type: "string" } }, required: ["folio"], additionalProperties: false },
    rpc: "buscar_folio", map: (i) => ({ p_folio: String(i.folio ?? "") }),
  },
  {
    // BQ10 — changelog: qué trajo la última actualización / en qué versión salió algo.
    name: "changelog_reciente",
    description: "Devuelve las últimas versiones publicadas (web y app) con su título y lista de cambios. Úsala cuando el usuario pregunte '¿qué trajo la última actualización?', '¿qué cambió?', o '¿en qué versión se implementó X?'.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { limite: { type: "integer" } }, additionalProperties: false },
    rpc: "changelog_reciente", map: (i) => ({ p_limite: Math.min(Number(i.limite ?? 8), 30) }),
  },
  {
    // AY C4 — memoria: recuerda una preferencia del usuario entre conversaciones.
    // CR1 §B1: NO se ofrece en MCP — "la memoria de Claude es la suya".
    name: "recordar",
    description: "Guarda una preferencia o dato operativo del usuario para recordarlo en futuras conversaciones (p. ej. su obra por defecto, formato preferido, a quién suele asignar). Es SOLO del propio usuario. Úsalo cuando el usuario diga 'recuerda que…' o exprese una preferencia estable.",
    modulos: null, canales: ["compa"], memoria: true,
    input_schema: { type: "object", properties: { clave: { type: "string" }, valor: { type: "string" } }, required: ["clave", "valor"] },
  },
  {
    // AY11/C2 — genera un PDF descargable. Los datos salen de una consulta con
    // los permisos del usuario (hereda RLS): si no puede ver el dato, no hay PDF.
    // CR1 §B1: NO se ofrece en MCP — "Claude ya hace sus archivos".
    name: "generar_reporte_pdf",
    description: "Genera uno o varios reportes descargables en PDF o Excel — PUEDES entregar VARIOS archivos en el mismo turno, llama esta herramienta una vez por cada uno que el usuario pida (hasta 20 en total por turno). Tipos: 'usuarios' (listado de usuarios, solo admin), 'stock_almacen' (existencias — pasa 'bodega_ids' con uno o varios ids de 'listar_almacenes'; con varios, por defecto arma UN solo PDF con una sección por almacén en el orden que diste, o usa separados:true si el usuario quiere un archivo por almacén), 'requisiciones' (mismos filtros que 'listar_requisiciones': desde, hasta, proyecto_id, solicitante_id, estado), 'desempeno_semana' (desempeño de choferes de la semana), 'conduces_dia' (conduces emitidos hoy). Usa formato 'excel' si el usuario pide Excel/hoja de cálculo; si no, PDF. El archivo hereda tus permisos. Tras generarlo(s), dile al usuario que su(s) descarga(s) están listas abajo — y SOLO entonces, nunca antes de que la herramienta devuelva 'generado:true'.",
    modulos: null, canales: ["compa"], pdf: true,
    input_schema: { type: "object", properties: {
      tipo: { type: "string", description: "usuarios | stock_almacen | requisiciones | desempeno_semana | conduces_dia" },
      formato: { type: "string", description: "pdf | excel (por defecto pdf)" },
      bodega_ids: { type: "array", items: { type: "string" }, description: "uno o varios ids de almacén (de 'listar_almacenes'), para 'stock_almacen'" },
      separados: { type: "boolean", description: "con varios bodega_ids: true = un archivo por almacén; false/omitido = un solo PDF con una sección por almacén" },
      bodega_id: { type: "string", description: "compatibilidad: un solo almacén (equivalente a bodega_ids con 1 elemento)" },
      desde: { type: "string", description: "YYYY-MM-DD, para 'requisiciones'" }, hasta: { type: "string", description: "YYYY-MM-DD, para 'requisiciones'" },
      proyecto_id: { type: "string" }, solicitante_id: { type: "string" }, estado: { type: "string" },
      anio: { type: "integer" }, semana: { type: "integer" },
    }, required: ["tipo"] },
  },
  {
    name: "listar_almacenes",
    description: "Lista los almacenes/bodegas con su id y nombre, para usarlos como origen de un conduce o para consultar stock. Devuelve todos los almacenes visibles para el usuario. Regla de desambiguación (BB1): si el usuario nombró un calificativo que distingue a UN almacén (p. ej. dijo 'central' y existe 'Bodega Central'), asume ese y anúncialo ('Asumo Bodega Central — dime si era otro'); pregunta solo si dos o más almacenes encajan igual de bien con lo que dijo. Requiere el módulo inventario.",
    modulos: ["inventario"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "ubicaciones_almacen", map: () => ({ p_incluir_prueba: false }),
  },
  {
    name: "despachantes_disponibles",
    description: "Despachantes ELEGIBLES para firmar un conduce desde un almacén hacia una obra (regla de elegibilidad AV1).",
    modulos: ["inventario"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" }, proyecto_id: { type: "string" } } },
    rpc: "despachantes_disponibles", map: (i) => ({ p_bodega_id: i.bodega_id ?? null, p_proyecto_id: i.proyecto_id ?? null }),
  },
  {
    name: "requisiciones_pendientes",
    description: "Bandeja de requisiciones. Filtra por estado/urgencia/texto. Requiere inventario o compras.",
    modulos: ["inventario", "compras"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { estado: { type: "string" }, urgencia: { type: "string" }, busqueda: { type: "string" } } },
    rpc: "requisiciones_bandeja",
    map: (i) => ({ p_estado: i.estado ?? "pendiente", p_proyecto_id: null, p_urgencia: i.urgencia ?? null, p_busqueda: i.busqueda ?? null, p_limite: 30 }),
  },
  {
    name: "resumen_proyectos",
    description: "KPIs/resumen de los proyectos. Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "kpi_proyectos", map: () => ({}),
  },
  {
    name: "log_combustible",
    description: "Echadas de combustible recientes (galones, rendimiento). Requiere flota.",
    modulos: ["flota"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
    rpc: "log_combustible", map: (i) => ({ p_desde: i.desde ?? null, p_hasta: i.hasta ?? null, p_vehiculo_id: null, p_usuario_id: null }),
  },

  // ── AY9/C1 — cobertura de lectura módulo por módulo ────────────────────────
  // Flota
  {
    name: "listar_vehiculos",
    description: "Lista los vehículos de la flota (placa, marca, modelo, año, activo). Para \"¿cuántos vehículos tenemos?\". Requiere flota.",
    modulos: ["flota"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "flota_placas", map: () => ({}),
  },
  {
    name: "vehiculos_en_uso",
    description: "Vehículos actualmente EN USO (con quién, desde cuándo). Requiere flota.",
    modulos: ["flota"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "vehiculos_en_uso", map: () => ({}),
  },
  {
    name: "resumen_flota",
    description: "Resumen/conteos de la flota (total, activos, en mantenimiento, en uso, mantenimientos pendientes). Requiere flota.",
    modulos: ["flota"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "resumen_flota", map: () => ({}),
  },
  {
    name: "mantenimientos_pendientes",
    description: "Mantenimientos pendientes o en proceso de la flota. Requiere flota.",
    modulos: ["flota"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {} },
    rpc: "mantenimientos_pendientes", map: () => ({}),
  },
  // Inventario
  {
    name: "stock_por_almacen",
    description: "Existencias de un almacén/bodega (obtén el bodega_id con 'listar_almacenes'). Opcional: búsqueda por texto. Requiere inventario.",
    modulos: ["inventario"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" }, busqueda: { type: "string" } }, required: ["bodega_id"] },
    rpc: "inventario_almacen", map: (i) => ({ p_bodega_id: i.bodega_id, p_incluir_cero: false, p_busqueda: i.busqueda ?? null, p_incluir_catalogo: false }),
  },
  {
    name: "articulos_bajo_minimo",
    description: "Artículos por debajo de su stock mínimo en un almacén (obtén el bodega_id con 'listar_almacenes'). Requiere inventario.",
    modulos: ["inventario"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { bodega_id: { type: "string" } }, required: ["bodega_id"] },
    rpc: "articulos_bajo_minimo", map: (i) => ({ p_bodega_id: i.bodega_id }),
  },
  {
    name: "movimientos_recientes",
    description: "Últimos movimientos (entradas/salidas) de un artículo (obtén el articulo_id con 'buscar_articulos'). Requiere inventario.",
    modulos: ["inventario"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { articulo_id: { type: "string" }, limit: { type: "integer" } }, required: ["articulo_id"] },
    rpc: "ultimos_movimientos_articulo", map: (i) => ({ p_articulo_id: i.articulo_id, p_limit: Math.min(Number(i.limit ?? 10), 50) }),
  },
  {
    // BG4 — material dañado / en cuarentena (no despachable). "¿cuánto material
    // dañado hay en Bodega Central?". Solo muestra almacenes visibles al rol.
    name: "material_en_cuarentena",
    description: "Material DAÑADO en cuarentena (retirado, NO despachable) por almacén. Úsala para '¿cuánto material dañado hay?', '¿qué hay en cuarentena en Bodega Central?'. Opcional: filtro por texto (artículo o almacén). Solo muestra los almacenes que tu rol puede ver. Requiere inventario.",
    modulos: ["inventario"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
    rpc: "material_en_cuarentena", map: (i) => ({ p_query: i.query ?? null }),
  },
  // Incentivo (roles autorizados — puede_gestionar_incentivos)
  {
    name: "desempeno_semana",
    description: "Desempeño/incentivo de choferes de una semana ISO (por defecto la semana actual). Solo roles autorizados. Requiere módulo incentivos.",
    modulos: ["incentivos"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } } },
    rpc: "desempeno_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  // Proyectos (ficha = resumen_proyectos, ya existe arriba)
  {
    name: "cronograma_de_obra",
    description: "Cronograma (Gantt) de una obra: tareas, avance, dependencias (obtén el proyecto_id con 'mis_proyectos'). Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { proyecto_id: { type: "string" } }, required: ["proyecto_id"] },
    rpc: "listar_cronograma", map: (i) => ({ p_proyecto_id: i.proyecto_id }),
  },
  {
    name: "personal_de_obra",
    description: "Conteo del personal de una obra (total, por cargo, por nacionalidad) (obtén el proyecto_id con 'mis_proyectos'). Requiere proyectos o dirección.",
    modulos: ["proyectos", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { proyecto_id: { type: "string" } }, required: ["proyecto_id"] },
    rpc: "personal_obra_conteos", map: (i) => ({ p_proyecto_id: i.proyecto_id }),
  },
  {
    // BJ1 — cobertura de bitácoras por obra (pedido de Eduardo NG por WhatsApp).
    name: "cobertura_de_bitacoras",
    description: "Reporte de cuántas bitácoras hay POR OBRA, con su última fecha y su estado (al día / atrasada / SIN bitácoras). Úsala para '¿cuántas bitácoras hay por obra?', '¿qué obras están al día con la bitácora?', '¿qué obras no han hecho bitácora?', 'reporte de bitácoras por obra para los ingenieros'. Devuelve TODAS las obras activas, incluidas las que tienen 0 (que son las que hay que atender). Por defecto cuenta todo el histórico; pasa desde/hasta (YYYY-MM-DD) para acotar un rango. Requiere módulo bitácora, proyectos o dirección.",
    modulos: ["bitacora", "proyectos", "direccion"], canales: ["compa", "mcp"],
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
    modulos: null, canales: ["compa", "mcp"],
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
    modulos: null, canales: ["compa", "mcp"],
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
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "nombre, código o apodo del artículo (p. ej. 'puntales')" },
      articulo_id: { type: "string", description: "id exacto si ya lo resolviste (de buscar_articulos)" },
    }, additionalProperties: false },
    rpc: "disponibilidad_de_articulo", map: (i) => ({ p_query: i.query ?? null, p_articulo_id: i.articulo_id ?? null }),
  },
  {
    // BE2 — el backlog automático: cuando a Compa le falta una capacidad, la registra
    // (motivo sin_tool) para que Tecnología la construya. Sustituye las capturas a mano.
    // CR1 §B1: se ofrece también en MCP (ahí se presenta como "reportar_faltante" —
    // mismo registro, el edge mcp decide en FASE 3 si simplifica el matching de Compa).
    name: "reportar_gap",
    description: "Regístrala cuando el usuario te pide algo para lo que NO tienes ninguna herramienta (no cuando una herramienta falla, eso ya se registra solo). Anota que a Compa le falta esa capacidad para que Tecnología la construya después. Llámala ANTES de disculparte, y luego dile al usuario con honestidad qué no puedes todavía y qué SÍ puedes ofrecerle como alternativa. No la uses para consultas que sí puedes resolver.",
    modulos: null, canales: ["compa", "mcp"], gap: true,
    input_schema: { type: "object", properties: {
      tema: { type: "string", description: "en pocas palabras, qué capacidad falta (p. ej. 'ver el historial de precios de un artículo')" },
    }, required: ["tema"], additionalProperties: false },
  },

  // ── BE1 — Reportes semanales (misma RPC que compone el correo del lunes) ───
  {
    // BE1(1) — requisiciones por obra × ingeniero. Preguntable cualquier día.
    name: "resumen_requisiciones_semana",
    description: "Resumen semanal de requisiciones: cuántas se crearon, por obra y por ingeniero solicitante, con el total. Úsala para '¿cuántas requisiciones hizo Torre Alpha esta semana?', '¿quién pidió más material?'. Por defecto la última semana cerrada (lunes-domingo); pasa anio + semana ISO para otra. Es la misma data del reporte del correo del lunes. Requiere módulo inventario, compras o dirección.",
    modulos: ["inventario", "compras", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      anio: { type: "integer" }, semana: { type: "integer", description: "semana ISO" },
    }, additionalProperties: false },
    rpc: "resumen_requisiciones_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(2) — estatus/embudo + pendientes por atender con su edad.
    name: "resumen_estatus_requisiciones",
    description: "Estatus semanal de las requisiciones: el embudo (creadas, pendientes, aprobadas, despachadas parcial/total, canceladas) y la LISTA de pendientes por atender con su antigüedad ('REQ-000123 · Torre Alpha · 4 días esperando'). Úsala para '¿qué requisiciones están atascadas?', '¿qué falta por despachar?', '¿se atendieron todas?'. Por defecto la última semana cerrada; pasa anio + semana ISO para otra. Requiere módulo inventario, compras o dirección.",
    modulos: ["inventario", "compras", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      anio: { type: "integer" }, semana: { type: "integer", description: "semana ISO" },
    }, additionalProperties: false },
    rpc: "resumen_estatus_requisiciones", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(3) — rutas hechas por chofer; cuarentena BB8 aparte.
    name: "resumen_rutas_semana",
    description: "Resumen semanal de rutas completadas: por chofer y total. Las 'en revisión' (rutas completadas sin km/tiempo trackeado — cuarentena BB8) se cuentan APARTE, no se mezclan. Úsala para '¿cuántas rutas se hicieron esta semana?', '¿quién hizo más rutas?'. Por defecto la última semana cerrada. Requiere módulo flota o dirección.",
    modulos: ["flota", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_rutas_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(4) — conduces emitidos por tipo y obra destino.
    name: "resumen_conduces_semana",
    description: "Resumen semanal de conduces emitidos: por tipo (normal / externo) y por obra destino, con el total. Úsala para '¿cuántos conduces se hicieron?', '¿a qué obra fueron más conduces?'. Por defecto la última semana cerrada. Requiere módulo inventario o dirección.",
    modulos: ["inventario", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_conduces_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(5) — movimiento de inventario por almacén.
    name: "resumen_inventario_semana",
    description: "Resumen semanal del movimiento de inventario por almacén: entradas, salidas y ajustes de la semana. Úsala para '¿cuánto movimiento hubo en el almacén X?', '¿qué almacén tuvo más entradas?'. Por defecto la última semana cerrada. Requiere módulo inventario o dirección.",
    modulos: ["inventario", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_inventario_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(6) — km + combustible de vehículos de carga (solo echadas válidas AW3).
    name: "resumen_flota_carga_semana",
    description: "Resumen semanal de los vehículos de CARGA (camiones): km recorridos, galones echados (solo echadas válidas, las corregidas no cuentan) y costo, por vehículo. Úsala para '¿cuánto combustible gastaron los camiones?', '¿cuántos km hicieron?'. Avisa si el km está en depuración (echadas sin odómetro). Por defecto la última semana cerrada. Requiere módulo flota o dirección.",
    modulos: ["flota", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_flota_carga_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },
  {
    // BE1(7) — bitácoras por obra vs días laborables (el "quién no está llenando").
    name: "resumen_bitacoras_semana",
    description: "Resumen semanal de bitácoras por obra: cuántos días de la semana tuvieron bitácora vs los días laborables ('Torre Alpha: 5/6 días'). Muestra las obras activas SIN bitácora — el 'quién no está llenando'. Úsala para '¿qué obras no están llenando la bitácora?', '¿cuántas bitácoras hubo?'. Por defecto la última semana cerrada. Requiere módulo bitacora, proyectos o dirección.",
    modulos: ["bitacora", "proyectos", "direccion"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { anio: { type: "integer" }, semana: { type: "integer" } }, additionalProperties: false },
    rpc: "resumen_bitacoras_semana", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },

  // ── ESCRITURA (v2: preparar → confirmar → ejecutar) ────────────────────────
  {
    name: "proponer_tarea",
    description: "PREPARA (borrador, NO crea) una tarea para asignar a alguien en una obra. Resuelve el proyecto_id con 'mis_proyectos' y, si se asigna a otra persona, su usuario_id con 'buscar_usuarios'. Si falta el título o la obra, pregúntalos. Al llamarla el sistema muestra una tarjeta para CONFIRMAR; hasta entonces la tarea NO existe. Requiere módulo tareas.",
    modulos: ["tareas"], canales: ["compa", "mcp"],
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
    modulos: ["inventario", "compras"], canales: ["compa", "mcp"],
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
    modulos: ["inventario"], canales: ["compa", "mcp"],
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
    modulos: ["flota"], canales: ["compa", "mcp"],
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

  // ── CO6 — consultas pedidas de verdad (#216) ───────────────────────────────
  {
    // Hector (ingeniero de oficina) pedía 4 veces "un reporte de las
    // requisiciones realizadas". puede_ver_todas_requisiciones() ya incluye su
    // rol (CO6); esta herramienta expone el rango de fechas y el solicitante que
    // 'requisiciones_pendientes' no tenía.
    name: "listar_requisiciones",
    description: "Lista requisiciones de material por rango de fechas, obra, solicitante o estado (a diferencia de 'requisiciones_pendientes', esta SÍ incluye las ya atendidas — para '¿qué requisiciones se han hecho?', 'dame un reporte de requisiciones de este mes', 'las requisiciones de Torre Alpha de octubre'). Resuelve proyecto_id/solicitante_id con 'mis_proyectos'/'buscar_usuarios' si el usuario nombra la obra o la persona. Si pide el resultado 'en PDF' o 'para descargar', dile que puedes generarlo con 'generar_reporte_pdf' tipo 'requisiciones' pasando los mismos filtros. Requiere módulo inventario, compras, o ser ingeniero de oficina/jefe de ingenieros/gerente.",
    modulos: ["inventario", "compras"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      desde: { type: "string", description: "YYYY-MM-DD" }, hasta: { type: "string", description: "YYYY-MM-DD" },
      proyecto_id: { type: "string" }, solicitante_id: { type: "string" }, estado: { type: "string" },
      limite: { type: "integer" },
    }, additionalProperties: false },
    rpc: "requisiciones_bandeja",
    map: (i) => ({
      p_estado: i.estado ?? null, p_proyecto_id: i.proyecto_id ?? null, p_urgencia: null, p_busqueda: null,
      p_limite: Math.min(Number(i.limite ?? 50), 200), p_desde: i.desde ?? null, p_hasta: i.hasta ?? null,
      p_solicitante_id: i.solicitante_id ?? null,
    }),
  },
  {
    // CONTEXTO §F: "ya el sistema genera ese reporte, solo quiero que lo veas" —
    // las 7 secciones YA eran tools individuales (AU1); esta las junta en una
    // sola respuesta, igual que el correo del lunes.
    name: "leer_reporte_semanal_operaciones",
    description: "Lee el resumen semanal de operaciones completo (requisiciones, rutas, conduces, inventario, flota de carga, bitácoras) — el mismo que se manda por correo los lunes. Úsala para 'háblame del reporte semanal', 'cuéntame sobre el reporte de esta semana', '¿qué dice el resumen de operaciones?'. Por defecto trae la ÚLTIMA semana cerrada; pasa anio+semana (ISO) para otra. Cada sección que tu rol no puede ver sale en 'secciones_omitidas' — dilo con naturalidad, no te disculpes de más.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      anio: { type: "integer" }, semana: { type: "integer", description: "semana ISO" },
    }, additionalProperties: false },
    rpc: "reporte_semanal_operaciones_compa", map: (i) => ({ p_anio: i.anio ?? null, p_semana: i.semana ?? null }),
  },

  // ── CP8 — Reuniones (después de CP3/CP9) ───────────────────────────────────
  // Regla madre (PERMISOS-TOOLS.md): mis_* = IDENTIDAD ESTRICTA, sin escape de
  // módulo/admin (la lección de la fuga mis_tareas). 'mis_reuniones' y
  // 'acuerdos_pendientes' van por 'mis_reuniones_compa'/'acuerdos_pendientes_compa'
  // (organizador/participante/responsable = uid), NUNCA por 'reuniones_listado'
  // (ese SÍ amplía a "todo el módulo" para quien tiene módulo reuniones — correcto
  // para la pantalla de Reuniones, pero rompería el contrato de un tool 'mis_*').
  {
    name: "mis_reuniones",
    description: "Reuniones PRÓXIMAS del usuario (donde es organizador o participante) — identidad estricta, no depende del módulo. Úsala para '¿tengo reuniones?', '¿qué reuniones tengo esta semana?', '¿a qué hora es mi próxima reunión?'.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_reuniones_compa", map: () => ({}),
  },
  {
    name: "acuerdos_pendientes",
    description: "Acuerdos de reuniones donde el usuario es el RESPONSABLE y todavía no están completados. Úsala para '¿qué acuerdos tengo pendientes?', '¿qué me comprometí a hacer en las reuniones?'. Identidad estricta.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "reunion_acuerdos_pendientes_mios", map: () => ({}),
  },
  {
    name: "resumen_reunion",
    description: "Resumen de una reunión (agenda, acuerdos, resumen del acta si existe). Puedes pasar el título/tema tal como lo diga el usuario (busca la que mejor calce entre las que puede ver); si no da ninguna pista, trae la próxima o, si no hay próxima, la última pasada. Respeta el acceso: solo participantes, organizador, o quien tiene el módulo reuniones.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { tema: { type: "string", description: "título o tema de la reunión, tal como lo mencionó el usuario (opcional)" } }, additionalProperties: false },
    rpc: "reunion_resumen_compa", map: (i) => ({ p_texto: i.tema ?? null }),
  },

  {
    name: "que_puedo_consultar",
    description: "LLÁMALA PRIMERO cuando no sepas qué herramienta usar o si el usuario pregunta algo de un área que no reconoces. Devuelve, por módulo del SGC, si ESTA persona (con sus permisos reales) puede verlo y qué herramienta(s) usar para eso. Si un módulo sale con puede_ver=false, esa persona de verdad no tiene acceso — no insistas ni inventes datos.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "que_puedo_consultar", map: () => ({}),
  },

  // ── CS5 — cobertura del conector: módulos que hoy no tenían herramienta ────
  // Mensajería/Notas/Dev notes/Soporte: sin gate de módulo (como en la web),
  // identidad estricta (solo lo del propio usuario). Documentos/Legal/Admin:
  // gate de módulo (la RPC ya revalida con sgc.tiene_modulo/is_admin).
  {
    name: "mis_notas",
    description: "Las NOTAS del usuario (propias y compartidas con él): Dev notes (ambito='dev', solo si es desarrollador) y Notas generales. Devuelve título, un resumen del contenido (las imágenes salen como «[imagen]», no como ruta interna) y etiquetas. Pásale ambito='dev' para solo Dev notes, 'general' para solo Notas, u omite para ambas.",
    modulos: null, canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { ambito: { type: "string", enum: ["dev", "general"] } }, additionalProperties: false },
    rpc: "mis_notas_resumen", map: (i) => ({ p_ambito: i.ambito ?? null }),
  },
  {
    name: "mis_mensajes",
    description: "Las conversaciones del usuario en Mensajería (DMs y grupos), con el ÚLTIMO mensaje de cada una y cuántos no ha leído. No trae el historial completo, solo el resumen de cada conversación.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_conversaciones_resumen", map: () => ({}),
  },
  {
    name: "mis_reportes_soporte",
    description: "Los reportes de error/sugerencia/comentario que el propio usuario envió a Tecnología (Soporte), con su estado.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_reportes_soporte", map: () => ({}),
  },
  {
    name: "listar_plantillas_documento",
    description: "Plantillas de Documentos disponibles para rellenar (nombre, categoría). No trae el contenido de la plantilla, solo el listado.",
    modulos: ["documentos"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "listar_plantillas_documento", map: () => ({}),
  },
  {
    name: "listar_expedientes_legales",
    description: "Expedientes de Legal (contratos, reclamos, etc.): código, título, tipo, estado, prioridad, fecha límite y responsable. Filtra opcionalmente por estado.",
    modulos: ["legal"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: { estado: { type: "string" } }, additionalProperties: false },
    rpc: "listar_expedientes_legales", map: (i) => ({ p_estado: i.estado ?? null }),
  },
  {
    name: "listar_aprobaciones_legales",
    description: "Aprobaciones de Legal (contratos/documentos pendientes de visto bueno legal) y su estado.",
    modulos: ["legal"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "listar_aprobaciones_legales", map: () => ({}),
  },
  {
    name: "directorio_empleados",
    description: "Directorio de empleados de RRHH: nombre, cargo, si está activo. NUNCA incluye sueldo ni datos personales sensibles (eso se consulta solo desde RRHH en el SGC, no por aquí).",
    modulos: ["rrhh"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "directorio_empleados", map: () => ({}),
  },
  {
    name: "mis_ordenes_de_compra",
    description: "Las órdenes de compra del usuario (de sus solicitudes de compra): proveedor, total, estado.",
    modulos: ["compras"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "mis_ordenes_de_compra", map: () => ({}),
  },
  {
    name: "mis_solicitudes_movimiento",
    description: "Solicitudes de movimiento (logística ingeniero→transporte): qué se mueve, origen, destino, prioridad y estado. Filtra opcionalmente por estado, obra, prioridad o rango de fechas.",
    modulos: ["ingenieria", "transporte", "flota"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      estado: { type: "string" }, proyecto_id: { type: "string" }, prioridad: { type: "string" },
      desde: { type: "string", description: "YYYY-MM-DD" }, hasta: { type: "string", description: "YYYY-MM-DD" },
    }, additionalProperties: false },
    rpc: "solicitudes_movimiento_listar",
    map: (i) => ({ p_estado: i.estado ?? null, p_proyecto_id: i.proyecto_id ?? null, p_prioridad: i.prioridad ?? null, p_desde: i.desde ?? null, p_hasta: i.hasta ?? null }),
  },
  {
    name: "mi_rendimiento",
    description: "El rendimiento/incentivo semanal del propio usuario (chofer): puntaje, si cumplió el mínimo, decisión y motivo. Identidad estricta — solo lo del usuario que pregunta.",
    modulos: null, canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "incentivo_mi_rendimiento", map: () => ({}),
  },
  {
    name: "mi_actividad_auditoria",
    description: "Auditoría del sistema (quién hizo qué y cuándo) — SOLO para quien tiene acceso a Auditoría (la RPC ya lo exige). Filtra por tabla, acción, actor o rango de fechas.",
    modulos: ["admin"], canales: ["compa", "mcp"],
    input_schema: { type: "object", properties: {
      tabla: { type: "string" }, accion: { type: "string" }, desde: { type: "string" }, hasta: { type: "string" }, buscar: { type: "string" },
    }, additionalProperties: false },
    rpc: "auditoria_listar",
    map: (i) => ({ p_tabla: i.tabla ?? null, p_accion: i.accion ?? null, p_actor: null, p_desde: i.desde ?? null, p_hasta: i.hasta ?? null, p_buscar: i.buscar ?? null, p_limite: 40, p_offset: 0 }),
  },
  {
    name: "listar_usuarios_admin",
    description: "Lista de usuarios con sus roles (nombre, correo, activo, roles) — solo administradores. NUNCA incluye contraseñas, PINs ni otros secretos.",
    modulos: ["admin"], canales: ["compa", "mcp"], input_schema: { type: "object", properties: {}, additionalProperties: false },
    rpc: "listar_usuarios_admin", map: () => ({}),
  },
];

/** Herramientas visibles a este usuario (filtro por módulo/admin), opcionalmente
 * acotadas a un canal ('compa' | 'mcp'). Sin `canal`, se comporta exactamente
 * como el `toolsParaUsuario` original de assistant/index.ts (no filtra por canal)
 * — así Compa no cambia de comportamiento al adoptar este registro. */
export function toolsParaUsuario(cap: Cap, canal?: "compa" | "mcp"): ToolDef[] {
  return TOOLS.filter((t) =>
    (t.modulos === null || cap.es_admin || t.modulos.some((m) => cap.modulos.includes(m))) &&
    (!canal || t.canales.includes(canal)),
  );
}

// BB3 — Clave de idempotencia determinística por INTENCIÓN de acción: dos propuestas
// idénticas (mismo tipo + mismos parámetros esenciales) producen la MISMA clave → el
// sistema las deduplica (Compa no vuelve a proponer, confirmar dos veces = un documento).
export function claveIdem(usuarioId: string, tipo: string, params: Any): string {
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
export function idemUuid(clave: string): string {
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

// Ejecuta una herramienta de LECTURA (rpc + map) genérica — el único tipo de
// ejecución que de verdad es idéntica entre Compa y MCP (las demás: pdf/gap/
// memoria/write tienen contexto propio del edge que las llama). Siempre fija
// el schema "sgc" explícitamente: el cliente de `withSupabase()` (MCP) no
// tiene una opción de schema por defecto como `createClient({db:{schema}})`
// (Compa) — sin esto, el error es "Could not find the function public.<rpc>".
export async function ejecutarHerramientaLectura(supabase: Any, cfg: ToolDef, input: Any) {
  return await supabase.schema("sgc").rpc(cfg.rpc!, cfg.map!(input ?? {}));
}
