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
      id: a.id, nombre: a.nombre, unidad: 'ud', categoria_id: 1, activo: true, es_prueba: false,
      requiere_talla: false, unidad_paquete: null, factor_paquete: null, stock_minimo: 0, stock_maximo: null, nota: null,
    })),
    categorias_inventario: [{ id: 1, nombre: 'Materiales de construcción (demo)', activo: true }],
    bodegas: [{ id: 'alm-central', nombre: 'Almacén Central (demo)', es_central: true, es_prueba: false, proyecto_id: 'obra-norte' }],
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

/** Piloto: "Crear una requisición". Objetivos que suman 100. */
export const MISION_CREAR_REQUISICION: MisionPractica = {
  id: 'web-crear-requisicion',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear una requisición',
  intro: 'Practica cómo pedir material para una obra. Nada de esto es real — es para que aprendas el flujo sin miedo a equivocarte.',
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
};

/** 7b — "Transferir un conduce" (el flujo de CM4: chofer + receptor). */
export const MISION_TRANSFERIR_CONDUCE: MisionPractica = {
  id: 'web-transferir-conduce',
  plataforma: 'web',
  roles: [],
  titulo: 'Transferir un conduce',
  intro: 'Tienes un conduce en tu poder y el material va a cambiar de chofer. Transfiérelo al chofer correcto y deja claro quién lo recibe en la obra.',
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
};

export const MISIONES_PILOTO: MisionPractica[] = [
  MISION_CREAR_REQUISICION,
  MISION_APROBAR_DESPACHAR,
  MISION_TRANSFERIR_CONDUCE,
  MISION_ENTRADA_INVENTARIO,
  MISION_CONTEO,
];
