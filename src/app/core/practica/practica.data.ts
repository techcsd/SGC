import { MisionPractica, FilaMaterial, FilaConteo, EscrituraPractica } from './practica.model';

/** CM7 — escenarios de mentira + objetivos por misión. Datos que NO existen de verdad. */
export const OBRAS_DEMO = [
  { id: 'obra-norte', nombre: 'OBRA DEMO — Torre Norte' },
  { id: 'obra-sur', nombre: 'OBRA DEMO — Residencial Sur' },
];
export const ARTICULOS_DEMO = [
  { id: 'art-cemento', nombre: 'Cemento gris 42.5 (saco)', stock: 320 },
  { id: 'art-varilla', nombre: 'Varilla 1/2" (unidad)', stock: 540 },
  { id: 'art-bloque', nombre: 'Bloque 6" (unidad)', stock: 1200 },
];
const ALMACENES_DEMO = [
  { id: 'alm-central', nombre: 'Almacén Central (demo)' },
  { id: 'alm-norte', nombre: 'Almacén OBRA DEMO — Torre Norte' },
];
const CHOFERES_DEMO = [
  { id: 'ch-juan', nombre: 'Juan Pérez (chofer demo)' },
  { id: 'ch-pedro', nombre: 'Pedro Gómez (chofer demo)' },
];
const RECEPTORES_DEMO = [
  { id: 'rc-encargado', nombre: 'Encargado de obra (demo)' },
  { id: 'rc-almacen', nombre: 'Almacenero de obra (demo)' },
];

// F6 (DG5) — vehículos/conductores de mentira, compartidos por las misiones de Flota
// (combustible, checklist, mantenimiento, ruta). Mismo patrón: nombres "(demo)",
// nunca escriben de verdad.
const VEHICULOS_DEMO = [
  { id: 'veh-demo-1', placa: 'DEMO-001', marca: 'Toyota', modelo: 'Hilux', tipo: 'pickup', activo: true, es_prueba: false, responsable: null },
  { id: 'veh-demo-2', placa: 'DEMO-002', marca: 'Hino', modelo: '300', tipo: 'camion', activo: true, es_prueba: false, responsable: null },
];
const CONDUCTORES_DEMO = [
  { id: 'cond-demo-1', nombre: 'Juan Pérez (chofer demo)', activo: true, vehiculo: null, usuario: null },
  { id: 'cond-demo-2', nombre: 'Pedro Gómez (chofer demo)', activo: true, vehiculo: null, usuario: null },
];
const BODEGAS_DEMO = [
  { id: 'alm-central', nombre: 'Almacén Central (demo)', es_central: true, es_principal_obra: false, es_prueba: false, proyecto_id: null, activo: true },
  { id: 'alm-norte', nombre: 'Almacén OBRA DEMO — Torre Norte (demo)', es_central: false, es_principal_obra: true, es_prueba: false, proyecto_id: 'obra-norte', activo: true },
];

// Helpers de lectura tipada sobre la respuesta en memoria.
const mats = (v: unknown): FilaMaterial[] => (Array.isArray(v) ? (v as FilaMaterial[]) : []);
const conteo = (v: unknown): FilaConteo[] => (Array.isArray(v) ? (v as FilaConteo[]) : []);
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');

// CM7 7b — lee lo que el usuario escribió en la PANTALLA REAL (capturado en memoria).
interface ReqBody { p_proyecto_id?: string | null; p_urgencia?: string | null; p_items?: { cantidad?: number }[]; }
const reqBody = (esc: EscrituraPractica[]): ReqBody =>
  (esc.find((e) => e.tabla === 'rpc:crear_solicitud_material')?.body as ReqBody) ?? {};
const reqItems = (esc: EscrituraPractica[]): { cantidad?: number }[] => {
  const its = reqBody(esc).p_items;
  return Array.isArray(its) ? its : [];
};

/** CM7 7a — escenario de "Crear una requisición": obras/materiales/categorías/bodegas de
 *  mentira para que la pantalla real renderice. El create (crear_solicitud_material) se
 *  captura y evalúa; nada sale a la red. */
const ESCENARIO_REQUISICION = {
  tablas: {
    proyectos: OBRAS_DEMO.map((o) => ({
      id: o.id, nombre: o.nombre, codigo: 'DEMO', activo: true, estado: 'en_ejecucion', es_prueba: false,
    })),
    articulos: ARTICULOS_DEMO.map((a) => ({
      id: a.id, nombre: a.nombre, codigo: a.id.replace('art-', 'DEMO-').toUpperCase(), unidad: 'ud', categoria_id: 1, activo: true, es_prueba: false,
      requiere_talla: false, unidad_paquete: null, factor_paquete: null, stock_minimo: 0, stock_maximo: null, nota: null,
    })),
    categorias_inventario: [{ id: 1, nombre: 'Materiales de construcción (demo)', activo: true }],
    bodegas: [{ id: 'alm-central', nombre: 'Almacén Central (demo)', es_central: true, es_prueba: false, proyecto_id: 'obra-norte', activo: true }],
    solicitudes_material: [] as unknown[],
  },
  rpc: {
    crear_solicitud_material: 'practica-req-0001',
    directorio_usuarios_detalle: [] as unknown[],
    editar_requisicion: { ok: true },
  },
};

// CM7 7b — "Registrar una entrada de inventario": mismo set demo + proveedor/órdenes.
interface EntradaBody { p_bodega_id?: string | null; p_origen_tipo?: string | null; p_items?: { cantidad?: number }[]; }
const entradaBody = (esc: EscrituraPractica[]): EntradaBody =>
  (esc.find((e) => e.tabla === 'rpc:registrar_entrada_inventario')?.body as EntradaBody) ?? {};
const entradaItems = (esc: EscrituraPractica[]): { cantidad?: number }[] => {
  const its = entradaBody(esc).p_items;
  return Array.isArray(its) ? its : [];
};
const ESCENARIO_ENTRADA = {
  tablas: {
    ...ESCENARIO_REQUISICION.tablas,
    proveedores: [{ id: 'prov-demo', nombre: 'Ferretería Demo S.R.L.', activo: true, es_prueba: false }],
    ordenes_compra: [] as unknown[],
    movimientos_inventario: [] as unknown[],
  },
  rpc: {
    registrar_entrada_inventario: 'practica-entrada-0001',
    directorio_usuarios_detalle: [] as unknown[],
  },
};

// CM7 7b — "Hacer un conteo": stock demo por bodega + flujo abrir→guardar→cerrar→aplicar.
const tieneWrite = (esc: EscrituraPractica[], clave: string) => esc.some((e) => e.tabla === clave);
const guardarItems = (esc: EscrituraPractica[]): unknown[] => {
  const b = esc.find((e) => e.tabla === 'rpc:conteo_fisico_guardar')?.body as { p_items?: unknown[] } | undefined;
  return Array.isArray(b?.p_items) ? b!.p_items! : [];
};
const ESCENARIO_CONTEO = {
  tablas: {
    bodegas: ESCENARIO_REQUISICION.tablas.bodegas,
    articulos: ESCENARIO_REQUISICION.tablas.articulos,
    categorias_inventario: ESCENARIO_REQUISICION.tablas.categorias_inventario,
    conteos: [] as unknown[],
    stock_por_bodega: ARTICULOS_DEMO.map((a) => ({ articulo_id: a.id, cantidad: a.stock, articulo: { nombre: a.nombre, codigo: 'DEMO' } })),
  },
  rpc: {
    conteo_fisico_abrir: 'practica-conteo-0001',
    conteo_fisico_guardar: { ok: true },
    conteo_fisico_cerrar: { ok: true },
    conteo_fisico_aplicar: { ok: true, ajustados: 0 },
    directorio_usuarios_detalle: [] as unknown[],
  },
};

// CM7 7b — "Generar un documento": una plantilla demo con campos para rellenar.
const docWriteBody = (esc: EscrituraPractica[]): { valores?: Record<string, unknown> } => {
  const b = esc.find((e) => e.tabla === 'documentos_generados')?.body;
  const row = Array.isArray(b) ? b[0] : b;
  return (row as { valores?: Record<string, unknown> }) ?? {};
};
const ESCENARIO_DOCUMENTO = {
  tablas: {
    proyectos: ESCENARIO_REQUISICION.tablas.proyectos,
    documentos_generados: [] as unknown[],
    plantillas_documento: [{
      id: 'plantilla-demo',
      nombre: 'Carta de entrega de materiales (demo)',
      categoria: 'acta_incidencia',
      activo: true,
      es_prueba: false,
      contenido_html: '<h3>Entrega de materiales</h3><p>Hoy {{fecha}} se entrega a <b>{{receptor}}</b> el siguiente material: {{detalle}}.</p>',
      campos: [
        { key: 'receptor', label: 'Nombre de quien recibe', tipo: 'texto' },
        { key: 'fecha', label: 'Fecha de entrega', tipo: 'fecha' },
        { key: 'detalle', label: 'Material entregado', tipo: 'textarea' },
      ],
    }],
  },
  rpc: { directorio_usuarios_detalle: [] as unknown[] },
};

// CM7 7b — "Aprobar una requisición" (pantalla real /inventario/requisiciones). Llega un
// pedido pendiente; se abre el drawer, se elige el almacén de despacho y se aprueba.
const aprobarBody = (esc: EscrituraPractica[]): { p_bodega_id?: string | null; p_items?: { cantidad?: number }[] } =>
  (esc.find((e) => e.tabla === 'rpc:aprobar_requisicion')?.body as { p_bodega_id?: string | null; p_items?: { cantidad?: number }[] }) ?? {};
const aprobarItems = (esc: EscrituraPractica[]): { cantidad?: number }[] => {
  const its = aprobarBody(esc).p_items;
  return Array.isArray(its) ? its : [];
};
const ESCENARIO_APROBAR = {
  tablas: {
    articulos: ESCENARIO_REQUISICION.tablas.articulos,
    categorias_inventario: ESCENARIO_REQUISICION.tablas.categorias_inventario,
    bodegas: [
      { id: 'alm-central', nombre: 'Almacén Central (demo)', es_central: true, es_prueba: false, proyecto_id: null, activo: true, proyecto: null },
      { id: 'alm-norte', nombre: 'Almacén OBRA DEMO — Torre Norte (demo)', es_central: false, es_prueba: false, proyecto_id: 'obra-norte', activo: true, proyecto: { nombre: 'OBRA DEMO — Torre Norte' } },
    ],
    // Un pedido pendiente, pre-formado con su embed (el cliente de práctica devuelve la
    // fila tal cual; por eso trae proyecto/solicitante/items/fase ya anidados).
    solicitudes_material: [{
      id: 'req-demo-apr-1', folio: 9007, proyecto_id: 'obra-norte', proyecto: { nombre: 'OBRA DEMO — Torre Norte' },
      solicitante_id: 'u-demo-eng',
      solicitante: { nombre: 'Ingeniero de obra (demo)', roles: [{ rol: { codigo: 'ingeniero_campo', nombre: 'Ingeniero de campo' } }] },
      estado: 'pendiente', urgencia: 'urgente', fecha_necesidad: null, fase: 'pendiente',
      notas: 'Para la fundición de la losa del nivel 3.', salida_id: null, solicitud_compra_id: null,
      bodega_id: null, atendido_por: null, atendido: null, atendido_en: null,
      created_at: '2026-10-13T08:00:00Z', version: 1, motivo_rechazo: null,
      cancelada_motivo: null, cerrada_por: null, cerrada_en: null, cerrada: null,
      items: [{ id: 'it-apr-1', solicitud_id: 'req-demo-apr-1', articulo_id: 'art-cemento', descripcion: 'Cemento gris 42.5 (saco)', cantidad: 100, unidad: 'ud', talla: null }],
    }],
  },
  rpc: {
    directorio_usuarios_detalle: [{ id: 'u-demo-eng', nombre: 'Ingeniero de obra (demo)', roles: ['ingeniero_campo'] }] as unknown[],
    aprobar_requisicion: { salida_id: 'practica-salida-apr-1', solicitud_compra_id: null, despachado_total: 100, faltante_total: 0 },
    requisicion_avance: [] as unknown[],
    requisicion_cobertura: [] as unknown[],
    buscar_articulos: ARTICULOS_DEMO.map((a) => ({ id: a.id, nombre: a.nombre, codigo: 'DEMO', unidad: 'ud' })) as unknown[],
  },
};

/** CM7 7b — "Generar un documento" (plantilla → rellenar → generar). */
export const MISION_GENERAR_DOCUMENTO: MisionPractica = {
  id: 'web-generar-documento',
  plataforma: 'web',
  roles: [],
  titulo: 'Generar un documento',
  intro: 'Vas a generar un documento a partir de una plantilla: eliges la plantilla, rellenas sus datos y lo generas. Nada de esto es real.',
  tiempoEstimadoMin: 3,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/documentos/generar',
  escenario: ESCENARIO_DOCUMENTO,
  metaWrite: 'documentos_generados',
  objetivosReales: [
    { id: 'gen', texto: 'Generaste el documento', puntos: 50, cumple: (esc) => tieneWrite(esc, 'documentos_generados'),
      consejo: 'Elige la plantilla, rellena y toca Generar.' },
    { id: 'campos', texto: 'Rellenaste los datos de la plantilla', puntos: 50,
      cumple: (esc) => { const v = docWriteBody(esc).valores ?? {}; return Object.values(v).some((x) => !!x && String(x).trim()); },
      consejo: 'Escribe quién recibe, la fecha y el material.' },
  ],
};

/** Piloto: "Crear una requisición". Objetivos que suman 100. */
export const MISION_CREAR_REQUISICION: MisionPractica = {
  id: 'web-crear-requisicion',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear una requisición',
  intro: 'Practica cómo pedir material para una obra. Nada de esto es real — es para que aprendas el flujo sin miedo a equivocarte.',
  tiempoEstimadoMin: 5,
  version: 1,
  campos: [
    { id: 'obraId', tipo: 'select', label: 'Obra', placeholder: '— Elige la obra —', opciones: OBRAS_DEMO },
    { id: 'items', tipo: 'materiales', label: 'Materiales', opciones: ARTICULOS_DEMO, ayuda: 'Agrega los materiales que necesitas y su cantidad.' },
    { id: 'fechaNecesidad', tipo: 'fecha', label: 'Fecha de necesidad' },
    { id: 'motivo', tipo: 'texto', label: '¿Para qué? (motivo)', placeholder: 'Ej. fundición de la losa del nivel 3…' },
  ],
  objetivos: [
    { id: 'obra', texto: 'Elegiste la obra', puntos: 20, cumple: (r) => !!r['obraId'], consejo: 'Toda requisición es para una obra.' },
    { id: 'items', texto: 'Agregaste al menos un material', puntos: 25, cumple: (r) => mats(r['items']).length > 0, consejo: 'Agrega los materiales que necesitas.' },
    { id: 'cantidades', texto: 'Todas las cantidades son mayores a 0', puntos: 20,
      cumple: (r) => mats(r['items']).length > 0 && mats(r['items']).every((i) => i.cantidad > 0), consejo: 'Una cantidad en 0 no pide nada.' },
    { id: 'necesidad', texto: 'Pusiste la fecha de necesidad', puntos: 15, cumple: (r) => !!r['fechaNecesidad'], consejo: 'La fecha ayuda a priorizar la compra.' },
    { id: 'justifica', texto: 'Escribiste el motivo / para qué', puntos: 20, cumple: (r) => !!txt(r['motivo']).trim(), consejo: 'Explica para qué es, así se aprueba más rápido.' },
  ],
  penalizaciones: [
    { id: 'sobre-stock', texto: 'Pediste más de lo que hay en stock de algún material', puntos: 10,
      aplica: (r) => mats(r['items']).some((i) => i.cantidad > i.stock) },
  ],
  // CM7 7b — PANTALLA REAL: la práctica navega a la pantalla real de requisiciones; los
  // objetivos se evalúan sobre lo que el usuario envió (capturado en memoria).
  rutaReal: '/bitacora/solicitudes-material',
  escenario: ESCENARIO_REQUISICION,
  metaWrite: 'rpc:crear_solicitud_material',
  objetivosReales: [
    { id: 'obra', texto: 'Elegiste una obra', puntos: 30, cumple: (esc) => !!reqBody(esc).p_proyecto_id,
      consejo: 'Arriba, elige la obra para la que pides el material.' },
    { id: 'items', texto: 'Agregaste al menos un material', puntos: 40, cumple: (esc) => reqItems(esc).length >= 1,
      consejo: 'Agrega al menos un artículo a la lista.' },
    { id: 'cant', texto: 'Las cantidades son mayores a 0', puntos: 20,
      cumple: (esc) => reqItems(esc).length > 0 && reqItems(esc).every((i) => Number(i.cantidad) > 0),
      consejo: 'Cada material necesita una cantidad mayor a 0.' },
    { id: 'urg', texto: 'Indicaste la urgencia', puntos: 10, cumple: (esc) => !!reqBody(esc).p_urgencia,
      consejo: 'Elige qué tan urgente es la requisición.' },
  ],
};

/** 7b — "Aprobar y despachar". Llega una requisición; la apruebas y despachas. */
export const MISION_APROBAR_DESPACHAR: MisionPractica = {
  id: 'web-aprobar-despachar',
  plataforma: 'web',
  roles: [],
  titulo: 'Aprobar y despachar',
  intro: 'Llegó una requisición de OBRA DEMO — Torre Norte pidiendo 100 sacos de cemento. Apruébala y despacha el material desde un almacén.',
  tiempoEstimadoMin: 5,
  version: 1,
  campos: [
    { id: 'decision', tipo: 'select', label: 'Decisión', placeholder: '— Elige —',
      opciones: [{ id: 'aprobar', nombre: 'Aprobar' }, { id: 'rechazar', nombre: 'Rechazar' }],
      ayuda: 'Para que la requisición avance, primero apruébala.' },
    { id: 'almacen', tipo: 'select', label: 'Almacén de origen', placeholder: '— ¿De dónde sale? —', opciones: ALMACENES_DEMO },
    { id: 'despacho', tipo: 'materiales', label: 'Material a despachar', opciones: ARTICULOS_DEMO,
      ayuda: 'Pidieron 100 sacos de cemento: despáchalos (sin pasarte del stock).' },
  ],
  objetivos: [
    { id: 'aprob', texto: 'Aprobaste la requisición', puntos: 25, cumple: (r) => r['decision'] === 'aprobar', consejo: 'Elige "Aprobar" para que avance.' },
    { id: 'alm', texto: 'Elegiste de qué almacén sale', puntos: 20, cumple: (r) => !!r['almacen'], consejo: 'El material siempre sale de un almacén.' },
    { id: 'desp', texto: 'Despachaste cemento', puntos: 25, cumple: (r) => mats(r['despacho']).some((i) => i.id === 'art-cemento' && i.cantidad > 0), consejo: 'Agrega el cemento que pidieron.' },
    { id: 'cubre', texto: 'La cantidad cubre lo pedido (100)', puntos: 30,
      cumple: (r) => mats(r['despacho']).some((i) => i.id === 'art-cemento' && i.cantidad >= 100), consejo: 'Despacha al menos los 100 sacos pedidos.' },
  ],
  penalizaciones: [
    { id: 'sobre-stock', texto: 'Despachaste más de lo que hay en stock', puntos: 15,
      aplica: (r) => mats(r['despacho']).some((i) => i.cantidad > i.stock) },
  ],
  // CM7 7b — PANTALLA REAL de aprobación (bandeja de requisiciones → drawer → aprobar).
  rutaReal: '/inventario/requisiciones',
  escenario: ESCENARIO_APROBAR,
  metaWrite: 'rpc:aprobar_requisicion',
  objetivosReales: [
    { id: 'abrir', texto: 'Abriste el pedido y pulsaste «Aprobar»', puntos: 20, cumple: (esc) => tieneWrite(esc, 'rpc:aprobar_requisicion'),
      consejo: 'Abre la requisición pendiente y dale a «Aprobar».' },
    { id: 'bodega', texto: 'Elegiste el almacén de despacho', puntos: 30, cumple: (esc) => !!aprobarBody(esc).p_bodega_id,
      consejo: 'El material siempre sale de un almacén concreto.' },
    { id: 'items', texto: 'Despachaste el cemento pedido', puntos: 30, cumple: (esc) => aprobarItems(esc).some((i) => Number(i.cantidad) > 0),
      consejo: 'Confirma la cantidad a despachar del renglón.' },
    { id: 'cubre', texto: 'La cantidad cubre lo pedido (100 sacos)', puntos: 20,
      cumple: (esc) => aprobarItems(esc).reduce((s, i) => s + Number(i.cantidad || 0), 0) >= 100,
      consejo: 'Despacha al menos los 100 sacos pedidos.' },
  ],
};

/** 7b — "Transferir un conduce" (el flujo de CM4: chofer + receptor). */
export const MISION_TRANSFERIR_CONDUCE: MisionPractica = {
  id: 'web-transferir-conduce',
  plataforma: 'web',
  roles: [],
  titulo: 'Transferir un conduce',
  intro: 'Tienes un conduce en tu poder y el material va a cambiar de chofer. Transfiérelo al chofer correcto y deja claro quién lo recibe en la obra.',
  tiempoEstimadoMin: 4,
  version: 1,
  campos: [
    { id: 'conduce', tipo: 'select', label: 'Conduce a transferir', placeholder: '— Elige el conduce —',
      opciones: [{ id: 'cnd-demo-1', nombre: 'CND DEMO-0001', sub: 'Cemento → OBRA DEMO — Torre Norte' }] },
    { id: 'nuevoChofer', tipo: 'select', label: 'Nuevo chofer', placeholder: '— ¿Quién lo lleva? —', opciones: CHOFERES_DEMO },
    { id: 'receptor', tipo: 'select', label: 'Quién recibe en la obra', placeholder: '— Elige el receptor —', opciones: RECEPTORES_DEMO,
      ayuda: 'Un conduce con receptor exige saber quién va a firmar al recibirlo.' },
    { id: 'motivo', tipo: 'texto', label: 'Motivo del cambio', placeholder: 'Ej. el chofer original se enfermó…' },
  ],
  objetivos: [
    { id: 'cnd', texto: 'Elegiste el conduce a transferir', puntos: 20, cumple: (r) => !!r['conduce'] },
    { id: 'chofer', texto: 'Asignaste el nuevo chofer', puntos: 30, cumple: (r) => !!r['nuevoChofer'], consejo: 'Transferir es ponerlo en manos de otro chofer.' },
    { id: 'rec', texto: 'Indicaste quién recibe', puntos: 30, cumple: (r) => !!r['receptor'], consejo: 'Sin receptor, nadie firma la entrega.' },
    { id: 'mot', texto: 'Explicaste el motivo del cambio', puntos: 20, cumple: (r) => !!txt(r['motivo']).trim(), consejo: 'Deja rastro de por qué cambió de chofer.' },
  ],
  penalizaciones: [],
};

/** 7b — "Registrar una entrada de inventario" (material que llega). */
export const MISION_ENTRADA_INVENTARIO: MisionPractica = {
  id: 'web-entrada-inventario',
  plataforma: 'web',
  roles: [],
  titulo: 'Registrar una entrada de inventario',
  intro: 'Llegó material de un proveedor con su conduce. Dale entrada al inventario, en el almacén correcto y con las cantidades reales.',
  tiempoEstimadoMin: 5,
  version: 1,
  campos: [
    { id: 'origen', tipo: 'select', label: 'Origen de la entrada', placeholder: '— ¿De dónde viene? —',
      opciones: [{ id: 'conduce-externo', nombre: 'Conduce externo (proveedor)' }, { id: 'compra', nombre: 'Orden de compra' }] },
    { id: 'almacenDestino', tipo: 'select', label: 'Almacén destino', placeholder: '— ¿A qué almacén entra? —', opciones: ALMACENES_DEMO },
    { id: 'items', tipo: 'materiales', label: 'Material que llegó', opciones: ARTICULOS_DEMO, ayuda: 'Registra lo que realmente recibiste, con su cantidad.' },
    { id: 'fecha', tipo: 'fecha', label: 'Fecha de recepción' },
  ],
  objetivos: [
    { id: 'ori', texto: 'Elegiste el origen de la entrada', puntos: 20, cumple: (r) => !!r['origen'] },
    { id: 'alm', texto: 'Elegiste el almacén destino', puntos: 20, cumple: (r) => !!r['almacenDestino'], consejo: 'El material entra a un almacén concreto.' },
    { id: 'items', texto: 'Registraste al menos un material', puntos: 30, cumple: (r) => mats(r['items']).length > 0 },
    { id: 'cant', texto: 'Las cantidades recibidas son mayores a 0', puntos: 20,
      cumple: (r) => mats(r['items']).length > 0 && mats(r['items']).every((i) => i.cantidad > 0), consejo: 'Una entrada en 0 no suma nada al inventario.' },
    { id: 'fecha', texto: 'Pusiste la fecha de recepción', puntos: 10, cumple: (r) => !!r['fecha'] },
  ],
  penalizaciones: [],
  // CM7 7b — PANTALLA REAL de entradas de inventario.
  rutaReal: '/inventario/entradas',
  escenario: ESCENARIO_ENTRADA,
  metaWrite: 'rpc:registrar_entrada_inventario',
  objetivosReales: [
    { id: 'bodega', texto: 'Elegiste el almacén destino', puntos: 30, cumple: (esc) => !!entradaBody(esc).p_bodega_id,
      consejo: 'El material entra a un almacén concreto.' },
    { id: 'items', texto: 'Registraste al menos un material', puntos: 40, cumple: (esc) => entradaItems(esc).length >= 1,
      consejo: 'Agrega lo que recibiste, con su cantidad.' },
    { id: 'cant', texto: 'Las cantidades son mayores a 0', puntos: 20,
      cumple: (esc) => entradaItems(esc).length > 0 && entradaItems(esc).every((i) => Number(i.cantidad) > 0),
      consejo: 'Una entrada en 0 no suma al inventario.' },
    { id: 'origen', texto: 'Indicaste el origen de la entrada', puntos: 10, cumple: (esc) => !!entradaBody(esc).p_origen_tipo,
      consejo: 'Di si vino por compra o por conduce externo.' },
  ],
};

/** 7b — "Hacer un conteo" físico de inventario. */
export const MISION_CONTEO: MisionPractica = {
  id: 'web-conteo',
  plataforma: 'web',
  roles: [],
  titulo: 'Hacer un conteo',
  intro: 'Vas a hacer el conteo físico del almacén. El sistema dice una cantidad; cuenta lo que realmente hay y anótalo. Si algo no cuadra, explícalo.',
  tiempoEstimadoMin: 6,
  version: 1,
  campos: [
    { id: 'conteo', tipo: 'conteo', label: 'Conteo físico', opciones: ARTICULOS_DEMO,
      ayuda: 'Escribe la cantidad REAL que contaste de cada material (la del sistema está a la izquierda).' },
    { id: 'observacion', tipo: 'texto', label: 'Observación (si hubo diferencias)', placeholder: 'Ej. faltaron 10 sacos de cemento, se moja la bodega…' },
  ],
  objetivos: [
    { id: 'todos', texto: 'Contaste todos los materiales', puntos: 50,
      cumple: (r) => conteo(r['conteo']).length > 0 && conteo(r['conteo']).every((i) => i.contado !== null && i.contado !== undefined),
      consejo: 'Deja todos los renglones con un número contado.' },
    { id: 'real', texto: 'Registraste cantidades reales (no todo en 0)', puntos: 20,
      cumple: (r) => conteo(r['conteo']).some((i) => (i.contado ?? 0) > 0), consejo: 'Cuenta de verdad: no dejes todo en 0.' },
    { id: 'dif', texto: 'Explicaste las diferencias (si las hubo)', puntos: 30,
      cumple: (r) => {
        const filas = conteo(r['conteo']);
        const hayDif = filas.some((i) => i.contado !== null && i.contado !== undefined && i.contado !== i.esperado);
        return hayDif ? !!txt(r['observacion']).trim() : filas.every((i) => i.contado !== null && i.contado !== undefined);
      },
      consejo: 'Si lo contado no cuadra con el sistema, escribe por qué.' },
  ],
  penalizaciones: [],
  // CM7 7b — PANTALLA REAL del conteo físico.
  rutaReal: '/inventario/conteos',
  escenario: ESCENARIO_CONTEO,
  metaWrite: 'rpc:conteo_fisico_aplicar',
  objetivosReales: [
    { id: 'abrir', texto: 'Abriste el conteo del almacén', puntos: 20, cumple: (esc) => tieneWrite(esc, 'rpc:conteo_fisico_abrir'),
      consejo: 'Elige el almacén y abre el conteo físico.' },
    { id: 'guardar', texto: 'Guardaste las cantidades contadas', puntos: 50, cumple: (esc) => guardarItems(esc).length >= 1,
      consejo: 'Escribe lo que contaste de cada material y guarda.' },
    { id: 'aplicar', texto: 'Aplicaste el stock real', puntos: 30, cumple: (esc) => tieneWrite(esc, 'rpc:conteo_fisico_aplicar'),
      consejo: 'Cierra y aplica para ajustar el inventario.' },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// F6 (DG5) — módulo "Demo" ampliado: 8 misiones nuevas, una por cada flujo real
// pedido (bitácora, conduce, combustible, checklist, solicitud de compra,
// mantenimiento, ruta, orden de trabajo). Mismo patrón que las de arriba: PANTALLA
// REAL + escenario de mentira + objetivos evaluados sobre las escrituras en memoria.
// ───────────────────────────────────────────────────────────────────────────

// "Registrar bitácora" — crear_entrada_bitacora (parte diario).
interface BitacoraBody { p_proyecto_id?: string | null; p_ingeniero_responsable?: string | null; p_comentarios?: string | null; }
const bitacoraBody = (esc: EscrituraPractica[]): BitacoraBody =>
  (esc.find((e) => e.tabla === 'rpc:crear_entrada_bitacora')?.body as BitacoraBody) ?? {};
const ESCENARIO_BITACORA = {
  tablas: { proyectos: ESCENARIO_REQUISICION.tablas.proyectos },
  rpc: { crear_entrada_bitacora: 'practica-bitacora-0001', directorio_usuarios_detalle: [] as unknown[] },
};
export const MISION_REGISTRAR_BITACORA: MisionPractica = {
  id: 'web-registrar-bitacora',
  plataforma: 'web',
  roles: [],
  titulo: 'Registrar bitácora',
  intro: 'Vas a registrar el parte diario de una obra: la obra, quién responde por el trabajo y qué pasó hoy. Nada de esto es real.',
  tiempoEstimadoMin: 7,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/bitacora/nueva',
  escenario: ESCENARIO_BITACORA,
  metaWrite: 'rpc:crear_entrada_bitacora',
  objetivosReales: [
    { id: 'obra', texto: 'Elegiste la obra', puntos: 40, cumple: (esc) => !!bitacoraBody(esc).p_proyecto_id,
      consejo: 'Toda bitácora es de una obra concreta.' },
    { id: 'ing', texto: 'Pusiste quién responde por el trabajo', puntos: 20, cumple: (esc) => !!txt(bitacoraBody(esc).p_ingeniero_responsable).trim(),
      consejo: 'El ingeniero responsable queda de registro.' },
    { id: 'coment', texto: 'Dejaste un comentario de lo que pasó hoy', puntos: 40, cumple: (esc) => !!txt(bitacoraBody(esc).p_comentarios).trim(),
      consejo: 'Describe brevemente el día de trabajo.' },
  ],
};

// "Crear un conduce" (externo — proveedor transporta material).
interface ConduceExtBody { p_placa_foto_path?: string | null; p_transporta_proveedor_id?: string | null; p_transporta_texto?: string | null; p_origen?: string | null; p_destino?: string | null; }
const conduceExtBody = (esc: EscrituraPractica[]): ConduceExtBody =>
  (esc.find((e) => e.tabla === 'rpc:crear_conduce_externo')?.body as ConduceExtBody) ?? {};
const ESCENARIO_CONDUCE = {
  tablas: { proveedores_transporte: [] as unknown[], articulos: ARTICULOS_DEMO, categorias_inventario: ESCENARIO_REQUISICION.tablas.categorias_inventario },
  rpc: { crear_conduce_externo: 'practica-conduce-ext-0001', proveedores_transporte_listado: [] as unknown[], buscar_lugares: [] as unknown[] },
};
export const MISION_CREAR_CONDUCE: MisionPractica = {
  id: 'web-crear-conduce',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear un conduce',
  intro: 'Un proveedor va a transportar material: toma la foto de la placa, di quién transporta y el origen y destino del viaje. Nada de esto es real.',
  tiempoEstimadoMin: 4,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/inventario/conduce-externo/nuevo',
  escenario: ESCENARIO_CONDUCE,
  metaWrite: 'rpc:crear_conduce_externo',
  objetivosReales: [
    { id: 'placa', texto: 'Tomaste la foto de la placa', puntos: 30, cumple: (esc) => !!conduceExtBody(esc).p_placa_foto_path,
      consejo: 'La placa del vehículo que transporta es obligatoria.' },
    { id: 'transporta', texto: 'Dijiste quién transporta', puntos: 25,
      cumple: (esc) => !!(conduceExtBody(esc).p_transporta_proveedor_id || txt(conduceExtBody(esc).p_transporta_texto).trim()),
      consejo: 'Elige un proveedor o escribe "Otro".' },
    { id: 'origen', texto: 'Indicaste el origen', puntos: 20, cumple: (esc) => !!txt(conduceExtBody(esc).p_origen).trim(), consejo: 'Escribe de dónde sale el material.' },
    { id: 'destino', texto: 'Indicaste el destino', puntos: 25, cumple: (esc) => !!txt(conduceExtBody(esc).p_destino).trim(), consejo: 'Escribe a dónde va el material.' },
  ],
};

// "Echar combustible" (registrar_combustible_app).
interface CombustibleBody { p_vehiculo_id?: string | null; p_galones?: number | null; p_kilometraje?: number | null; p_producto?: string | null; }
const combustibleBody = (esc: EscrituraPractica[]): CombustibleBody =>
  (esc.find((e) => e.tabla === 'rpc:registrar_combustible_app')?.body as CombustibleBody) ?? {};
const ESCENARIO_COMBUSTIBLE = {
  tablas: {
    vehiculos: VEHICULOS_DEMO, conductores: CONDUCTORES_DEMO, proyectos: ESCENARIO_REQUISICION.tablas.proyectos,
    estaciones_combustible: [{ id: 'est-demo', nombre: 'Estación Demo', activo: true, orden: 1 }],
    registros_combustible: [] as unknown[],
  },
  rpc: {
    precios_combustible_vigentes: [{ producto: 'diesel', precio: 260 }, { producto: 'gasolina', precio: 290 }],
    registrar_combustible_app: { id: 'practica-echada-0001' },
  },
};
export const MISION_ECHAR_COMBUSTIBLE: MisionPractica = {
  id: 'web-echar-combustible',
  plataforma: 'web',
  roles: [],
  titulo: 'Echar combustible',
  intro: 'Vas a registrar una echada de combustible: el vehículo, el kilometraje, los galones y la foto del recibo. Nada de esto es real.',
  tiempoEstimadoMin: 4,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/flota/combustible',
  escenario: ESCENARIO_COMBUSTIBLE,
  metaWrite: 'rpc:registrar_combustible_app',
  objetivosReales: [
    { id: 'veh', texto: 'Elegiste el vehículo', puntos: 30, cumple: (esc) => !!combustibleBody(esc).p_vehiculo_id, consejo: 'Toda echada es de un vehículo concreto.' },
    { id: 'gal', texto: 'Pusiste los galones', puntos: 30, cumple: (esc) => Number(combustibleBody(esc).p_galones ?? 0) > 0, consejo: 'Escribe cuántos galones le echaste.' },
    { id: 'km', texto: 'Pusiste el kilometraje', puntos: 20, cumple: (esc) => Number(combustibleBody(esc).p_kilometraje ?? 0) > 0, consejo: 'El kilometraje valida que no haya retrocesos.' },
    { id: 'prod', texto: 'Elegiste el producto (diésel/gasolina)', puntos: 20, cumple: (esc) => !!combustibleBody(esc).p_producto, consejo: 'Indica qué combustible echaste.' },
  ],
};

// "Checklist de vehículo" (registrar_checklist_vehiculo).
interface ChecklistBody { p_vehiculo_id?: string | null; p_tipo?: string | null; p_respuestas?: unknown[]; p_firma_path?: string | null; }
const checklistBody = (esc: EscrituraPractica[]): ChecklistBody =>
  (esc.find((e) => e.tabla === 'rpc:registrar_checklist_vehiculo')?.body as ChecklistBody) ?? {};
const PLANTILLA_CHECKLIST_DEMO = {
  id: 'plantilla-checklist-demo', codigo: 'DEMO-CHK-1', nombre: 'Checklist pre-uso (demo)',
  categoria: 'liviano', descripcion: null, activo: true, orden: 1, frecuencia: 'preuso', uso_aplica: 'ambos', tipo_vehiculo: null,
  items: [
    { id: 'item-demo-1', plantilla_id: 'plantilla-checklist-demo', seccion: 'General', numero: '1', etiqueta: 'Luces funcionando', es_critico: true, aplica_a: 'Ambos', orden: 1 },
    { id: 'item-demo-2', plantilla_id: 'plantilla-checklist-demo', seccion: 'General', numero: '2', etiqueta: 'Frenos en buen estado', es_critico: true, aplica_a: 'Ambos', orden: 2 },
    { id: 'item-demo-3', plantilla_id: 'plantilla-checklist-demo', seccion: 'General', numero: '3', etiqueta: 'Limpieza interior', es_critico: false, aplica_a: 'Ambos', orden: 3 },
  ],
};
const ESCENARIO_CHECKLIST = {
  tablas: { vehiculos: VEHICULOS_DEMO, conductores: CONDUCTORES_DEMO, checklist_plantillas: [PLANTILLA_CHECKLIST_DEMO], checklists_vehiculo: [] as unknown[] },
  rpc: { registrar_checklist_vehiculo: 'practica-checklist-0001' },
};
export const MISION_CHECKLIST_VEHICULO: MisionPractica = {
  id: 'web-checklist-vehiculo',
  plataforma: 'web',
  roles: [],
  titulo: 'Checklist de vehículo',
  intro: 'Vas a hacer el checklist de pre-uso de un vehículo: revisa cada punto y contesta con honestidad. Nada de esto es real.',
  tiempoEstimadoMin: 5,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/flota/checklists',
  escenario: ESCENARIO_CHECKLIST,
  metaWrite: 'rpc:registrar_checklist_vehiculo',
  objetivosReales: [
    { id: 'veh', texto: 'Elegiste el vehículo', puntos: 30, cumple: (esc) => !!checklistBody(esc).p_vehiculo_id, consejo: 'El checklist es de un vehículo concreto.' },
    { id: 'resp', texto: 'Contestaste los puntos del checklist', puntos: 50,
      cumple: (esc) => Array.isArray(checklistBody(esc).p_respuestas) && (checklistBody(esc).p_respuestas as unknown[]).length > 0,
      consejo: 'Marca cada punto: ok, no, o no aplica.' },
    { id: 'firma', texto: 'Firmaste el checklist', puntos: 20, cumple: (esc) => !!checklistBody(esc).p_firma_path, consejo: 'La firma deja constancia de quién lo hizo.' },
  ],
};

// "Crear solicitud de compra" (crear_solicitud_compra).
interface SolCompraBody { p_proyecto_id?: string | null; p_items?: { cantidad?: number }[]; p_notas?: string | null; }
const solCompraBody = (esc: EscrituraPractica[]): SolCompraBody =>
  (esc.find((e) => e.tabla === 'rpc:crear_solicitud_compra')?.body as SolCompraBody) ?? {};
const solCompraItems = (esc: EscrituraPractica[]): { cantidad?: number }[] => {
  const its = solCompraBody(esc).p_items;
  return Array.isArray(its) ? its : [];
};
const ESCENARIO_SOL_COMPRA = {
  tablas: {
    proyectos: ESCENARIO_REQUISICION.tablas.proyectos, articulos: ARTICULOS_DEMO,
    categorias_inventario: ESCENARIO_REQUISICION.tablas.categorias_inventario, solicitudes_compra: [] as unknown[],
  },
  rpc: { crear_solicitud_compra: 'practica-compra-0001' },
};
export const MISION_CREAR_SOLICITUD_COMPRA: MisionPractica = {
  id: 'web-crear-solicitud-compra',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear solicitud de compra',
  intro: 'Vas a pedir que se compre material que no hay en almacén: la obra, qué hace falta y cuánto. Nada de esto es real.',
  tiempoEstimadoMin: 4,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/bitacora/solicitudes-compra',
  escenario: ESCENARIO_SOL_COMPRA,
  metaWrite: 'rpc:crear_solicitud_compra',
  objetivosReales: [
    { id: 'obra', texto: 'Elegiste la obra', puntos: 30, cumple: (esc) => !!solCompraBody(esc).p_proyecto_id, consejo: 'Toda solicitud de compra es para una obra.' },
    { id: 'items', texto: 'Agregaste al menos un material a comprar', puntos: 40, cumple: (esc) => solCompraItems(esc).length >= 1, consejo: 'Agrega lo que hace falta comprar.' },
    { id: 'cant', texto: 'Las cantidades son mayores a 0', puntos: 30,
      cumple: (esc) => solCompraItems(esc).length > 0 && solCompraItems(esc).every((i) => Number(i.cantidad) > 0),
      consejo: 'Cada material necesita una cantidad mayor a 0.' },
  ],
};

// "Registrar mantenimiento" (tabla `mantenimientos`, insert directo).
interface MantBody { vehiculo_id?: string | null; tipo?: string | null; descripcion?: string | null; fecha?: string | null; }
const mantBody = (esc: EscrituraPractica[]): MantBody =>
  (esc.find((e) => e.tabla === 'mantenimientos')?.body as MantBody) ?? {};
const ESCENARIO_MANTENIMIENTO = {
  tablas: { vehiculos: VEHICULOS_DEMO, mantenimientos: [] as unknown[] },
  rpc: { listar_mantenimientos: [] as unknown[], listar_proveedores_para_flota: [] as unknown[] },
};
export const MISION_REGISTRAR_MANTENIMIENTO: MisionPractica = {
  id: 'web-registrar-mantenimiento',
  plataforma: 'web',
  roles: [],
  titulo: 'Registrar mantenimiento',
  intro: 'Vas a registrar un mantenimiento de un vehículo: cuál, de qué tipo y qué se le hizo. Nada de esto es real.',
  tiempoEstimadoMin: 4,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/flota/mantenimientos',
  escenario: ESCENARIO_MANTENIMIENTO,
  metaWrite: 'mantenimientos',
  objetivosReales: [
    { id: 'veh', texto: 'Elegiste el vehículo', puntos: 30, cumple: (esc) => !!mantBody(esc).vehiculo_id, consejo: 'El mantenimiento es de un vehículo concreto.' },
    { id: 'tipo', texto: 'Elegiste el tipo (preventivo/correctivo)', puntos: 20, cumple: (esc) => !!mantBody(esc).tipo, consejo: 'Indica si fue preventivo o correctivo.' },
    { id: 'desc', texto: 'Describiste qué se le hizo', puntos: 30, cumple: (esc) => !!txt(mantBody(esc).descripcion).trim(), consejo: 'Describe el trabajo realizado.' },
    { id: 'fecha', texto: 'Pusiste la fecha', puntos: 20, cumple: (esc) => !!mantBody(esc).fecha, consejo: 'La fecha ayuda a seguir el historial.' },
  ],
};

// "Crear una ruta" (tabla `rutas`, insert directo).
interface RutaBody { vehiculo_id?: string | null; origen?: string | null; destino?: string | null; tipo?: string | null; }
const rutaBody = (esc: EscrituraPractica[]): RutaBody =>
  (esc.find((e) => e.tabla === 'rutas')?.body as RutaBody) ?? {};
const ESCENARIO_RUTA = {
  tablas: {
    vehiculos: VEHICULOS_DEMO, conductores: CONDUCTORES_DEMO, rutas: [] as unknown[], bodegas: BODEGAS_DEMO,
  },
  rpc: { ruta_detalle_transporte: [] as unknown[] },
};
export const MISION_CREAR_RUTA: MisionPractica = {
  id: 'web-crear-ruta',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear una ruta',
  intro: 'Vas a planificar una ruta de transporte: el vehículo, de dónde a dónde. Nada de esto es real.',
  tiempoEstimadoMin: 4,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/flota/rutas',
  escenario: ESCENARIO_RUTA,
  metaWrite: 'rutas',
  objetivosReales: [
    { id: 'veh', texto: 'Elegiste el vehículo', puntos: 30, cumple: (esc) => !!rutaBody(esc).vehiculo_id, consejo: 'Toda ruta usa un vehículo concreto.' },
    { id: 'origen', texto: 'Indicaste el origen', puntos: 20, cumple: (esc) => !!txt(rutaBody(esc).origen).trim(), consejo: 'Escribe de dónde sale.' },
    { id: 'destino', texto: 'Indicaste el destino', puntos: 20, cumple: (esc) => !!txt(rutaBody(esc).destino).trim(), consejo: 'Escribe a dónde va.' },
    { id: 'tipo', texto: 'Elegiste el tipo de ruta', puntos: 30, cumple: (esc) => !!rutaBody(esc).tipo, consejo: 'Indica qué clase de viaje es.' },
  ],
};

// "Crear orden de trabajo" (crear_orden_trabajo — dos firmas: ingeniero + cliente).
interface OrdenTrabBody { p_proyecto_id?: string | null; p_descripcion?: string | null; p_firma_ing?: unknown; p_firma_cli?: unknown; }
const ordenTrabBody = (esc: EscrituraPractica[]): OrdenTrabBody =>
  (esc.find((e) => e.tabla === 'rpc:crear_orden_trabajo')?.body as OrdenTrabBody) ?? {};
const ESCENARIO_ORDEN_TRABAJO = {
  tablas: { proyectos: ESCENARIO_REQUISICION.tablas.proyectos },
  rpc: { crear_orden_trabajo: 'practica-orden-0001' },
};
export const MISION_CREAR_ORDEN_TRABAJO: MisionPractica = {
  id: 'web-crear-orden-trabajo',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear orden de trabajo',
  intro: 'Un cliente pidió un trabajo: descríbelo y captura las dos firmas (ingeniero y cliente). Nada de esto es real.',
  tiempoEstimadoMin: 6,
  version: 1,
  objetivos: [],
  penalizaciones: [],
  rutaReal: '/bitacora/orden-trabajo',
  escenario: ESCENARIO_ORDEN_TRABAJO,
  metaWrite: 'rpc:crear_orden_trabajo',
  objetivosReales: [
    { id: 'obra', texto: 'Elegiste la obra', puntos: 25, cumple: (esc) => !!ordenTrabBody(esc).p_proyecto_id, consejo: 'La orden de trabajo es para una obra.' },
    { id: 'desc', texto: 'Describiste el trabajo pedido', puntos: 25, cumple: (esc) => !!txt(ordenTrabBody(esc).p_descripcion).trim(), consejo: 'Describe qué pidió el cliente.' },
    { id: 'firmaIng', texto: 'Capturaste la firma del ingeniero', puntos: 25, cumple: (esc) => !!ordenTrabBody(esc).p_firma_ing, consejo: 'Firma en el recuadro de ingeniero.' },
    { id: 'firmaCli', texto: 'Capturaste la firma del cliente', puntos: 25, cumple: (esc) => !!ordenTrabBody(esc).p_firma_cli, consejo: 'Firma en el recuadro de cliente.' },
  ],
};

export const MISIONES_PILOTO: MisionPractica[] = [
  MISION_CREAR_REQUISICION,
  MISION_APROBAR_DESPACHAR,
  MISION_TRANSFERIR_CONDUCE,
  MISION_ENTRADA_INVENTARIO,
  MISION_CONTEO,
  MISION_GENERAR_DOCUMENTO,
  // F6 (DG5) — módulo Demo ampliado.
  MISION_REGISTRAR_BITACORA,
  MISION_CREAR_CONDUCE,
  MISION_ECHAR_COMBUSTIBLE,
  MISION_CHECKLIST_VEHICULO,
  MISION_CREAR_SOLICITUD_COMPRA,
  MISION_REGISTRAR_MANTENIMIENTO,
  MISION_CREAR_RUTA,
  MISION_CREAR_ORDEN_TRABAJO,
];

/** F6 (DG5) — misiones visibles para un conjunto de roles (admin las ve todas).
 *  Compartida por la lista de misiones (`/practica`) y "Mi progreso" (módulo Demo),
 *  para no duplicar el criterio de visibilidad por rol. */
export function misionesParaRoles(roles: string[]): MisionPractica[] {
  const esAdmin = roles.includes('admin');
  return MISIONES_PILOTO.filter((m) => esAdmin || m.roles.length === 0 || m.roles.some((r) => roles.includes(r)));
}
