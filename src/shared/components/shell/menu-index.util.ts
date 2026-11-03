// DG — índice único del menú, para el buscador maestro (Ctrl+K).
//
// Función PURA: no inyecta servicios ni lee el DOM/localStorage. Recibe el árbol de
// navegación (el MISMO array `navItems`/`adminNavItem` que pinta el sidebar en
// shell.html) y DOS funciones de permiso que el caller (Shell) ya tiene — `canAccess`
// / `canAccessChild` — para que el buscador NUNCA muestre una pantalla que el menú
// no mostraría. No hay una segunda fuente de verdad de permisos aquí.
//
// Nota de arquitectura (ver tarea DG — buscador maestro): `shell.html` pinta
// `navItems`/`adminNavItem` DIRECTAMENTE (sin transformación intermedia), así que
// esta función no reemplaza ni duplica cómo se pinta el sidebar — es una proyección
// derivada SOLO para el índice de búsqueda. Si en el futuro el sidebar deja de
// iterar el array crudo, este archivo es el lugar natural para unificar ambos.

/** Interfaces movidas aquí (antes vivían solo en shell.ts) para que el índice y el
 *  shell compartan un único tipo — ver shell.ts, que las reexporta. */
export interface NavItem {
  label: string;
  icon: string;
  route?: string;
  modulo?: string;
  badgeKey?: string;
  phase?: string;
  noChofer?: boolean;
  soloTecnologia?: boolean;
  soloDesarrollador?: boolean;
  flotaElevado?: boolean;
  submodulos?: string[];
  extraModulo?: string;
  soloConPendiente?: boolean;
  showIfAnyChild?: boolean;
  soloRoles?: string[];
  nuevoHasta?: string;
  children?: NavSubItem[];
}

export interface NavSubItem {
  label: string;
  route: string;
  modulo?: string;
  badgeKey?: string;
  flotaElevado?: boolean;
  soloTecnologia?: boolean;
  soloDesarrollador?: boolean;
  soloAdmin?: boolean;
  submodulo?: string;
  verTodasRequisiciones?: boolean;
}

/** Una fila navegable del índice: una pantalla (hijo con ruta) o un grupo con ruta
 *  propia (p. ej. si algún día un NavItem top-level tiene a la vez `route` y
 *  `children`, aparece también como "Módulo"). */
export interface IndiceMenuEntry {
  id: string;
  titulo: string;
  ruta: string;
  /** "Inventario › Conduces" — grupo padre + label del ítem, ya traducidos. */
  camino: string;
  modulo?: string;
  /** Tokens normalizados (sin acentos, minúsculas) para matchear: palabras del
   *  título + del camino + el módulo, sin duplicados. */
  palabrasClave: string[];
  /** true si esta fila es un grupo con ruta propia (no un hijo de un grupo). Hoy
   *  ningún NavItem del árbol real tiene route+children a la vez, pero se soporta. */
  esModulo: boolean;
}

export interface ConstruirIndiceOpciones {
  /** Misma lógica de permisos que ya decide qué ve el usuario en el sidebar. */
  canAccess: (item: NavItem) => boolean;
  canAccessChild: (child: NavSubItem) => boolean;
  /** Traducción opcional (BS4 `I18nService.t`) — identidad si no se pasa. Se aplica
   *  ANTES de tokenizar, así el buscador matchea en el idioma activo del usuario. */
  t?: (texto: string) => string;
}

function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 0);
}

/**
 * Aplana el árbol de navegación en filas buscables, respetando permisos. Una fila
 * por cada pantalla navegable:
 *  - Un `NavItem` SIN `children` (tiene `route`) → una fila.
 *  - Cada `NavSubItem` de un `NavItem` con `children` → una fila (el grupo padre en
 *    sí NO genera fila, salvo que también tenga `route` propia → ver `esModulo`).
 *
 * Grupos ocultos (`canAccess` false) no aportan ninguna fila, ni la suya ni la de
 * sus hijos — igual que el sidebar, que ni siquiera itera `children` si el padre
 * está oculto.
 */
export function construirIndiceMenu(
  items: NavItem[],
  opciones: ConstruirIndiceOpciones,
): IndiceMenuEntry[] {
  const t = opciones.t ?? ((s: string) => s);
  const filas: IndiceMenuEntry[] = [];

  for (const item of items) {
    if (!opciones.canAccess(item)) continue;
    if (item.phase) continue; // fase bloqueada: tampoco navegable desde el sidebar

    const labelItem = t(item.label);

    if (item.route) {
      // Pantalla de primer nivel (Dashboard, Reuniones, Compa, Notas…) o, si algún
      // día coexiste con `children`, también cuenta como "módulo" navegable.
      filas.push({
        id: `nav:${item.route}`,
        titulo: labelItem,
        ruta: item.route,
        camino: labelItem,
        modulo: item.modulo,
        palabrasClave: Array.from(new Set([...tokens(labelItem), ...(item.modulo ? tokens(item.modulo) : [])])),
        esModulo: !!item.children,
      });
    }

    for (const child of item.children ?? []) {
      if (!opciones.canAccessChild(child)) continue;
      const labelChild = t(child.label);
      const camino = `${labelItem} › ${labelChild}`;
      filas.push({
        id: `nav:${child.route}`,
        titulo: labelChild,
        ruta: child.route,
        camino,
        modulo: child.modulo ?? child.submodulo ?? item.modulo,
        palabrasClave: Array.from(
          new Set([
            ...tokens(labelChild),
            ...tokens(labelItem),
            ...(child.modulo ? tokens(child.modulo) : []),
            ...(child.submodulo ? tokens(child.submodulo) : []),
          ]),
        ),
        esModulo: false,
      });
    }
  }

  return filas;
}

/**
 * DG — Compa flotante: "en <módulo>" bajo la barra de la ventana. Reusa el MISMO
 * índice del buscador maestro (`IndiceMenuEntry[]`) — no se recalcula el módulo
 * activo por otro camino. Busca la entrada cuya `ruta` sea el prefijo más largo de
 * la ruta actual (soporta pantallas con parámetros, p. ej. `/inventario/conduces/123`
 * matchea la fila `/inventario/conduces`) y devuelve el primer tramo de `camino`
 * (el grupo/label de primer nivel, ya traducido).
 */
export function moduloActualDesdeRuta(pathname: string, indice: IndiceMenuEntry[]): string | null {
  let mejor: IndiceMenuEntry | null = null;
  for (const entrada of indice) {
    const coincide = pathname === entrada.ruta || pathname.startsWith(`${entrada.ruta}/`);
    if (coincide && (!mejor || entrada.ruta.length > mejor.ruta.length)) {
      mejor = entrada;
    }
  }
  return mejor ? mejor.camino.split(' › ')[0] : null;
}
