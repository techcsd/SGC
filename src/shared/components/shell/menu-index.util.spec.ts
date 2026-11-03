import { describe, it, expect } from 'vitest';
import { construirIndiceMenu, moduloActualDesdeRuta, NavItem } from './menu-index.util';

const ARBOL: NavItem[] = [
  { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  {
    label: 'Inventario',
    icon: 'inventory',
    modulo: 'inventario',
    children: [
      { label: 'Conduces', route: '/inventario/conduces', modulo: 'inventario' },
      { label: 'Artículos', route: '/inventario/articulos', modulo: 'inventario' },
    ],
  },
  {
    label: 'Developer',
    icon: 'developer',
    soloTecnologia: true,
    children: [{ label: 'Dev notes', route: '/tecnologia/dev-notes', soloDesarrollador: true }],
  },
];

describe('construirIndiceMenu', () => {
  it('genera una fila por pantalla de primer nivel y por cada hijo accesible', () => {
    const indice = construirIndiceMenu(ARBOL, {
      canAccess: () => true,
      canAccessChild: () => true,
    });
    const rutas = indice.map((e) => e.ruta);
    expect(rutas).toEqual([
      '/dashboard',
      '/inventario/conduces',
      '/inventario/articulos',
      '/tecnologia/dev-notes',
    ]);
  });

  it('NO genera fila para el grupo padre (Inventario) en sí, solo sus hijos', () => {
    const indice = construirIndiceMenu(ARBOL, { canAccess: () => true, canAccessChild: () => true });
    expect(indice.some((e) => e.titulo === 'Inventario')).toBe(false);
  });

  it('el camino concatena grupo › hijo', () => {
    const indice = construirIndiceMenu(ARBOL, { canAccess: () => true, canAccessChild: () => true });
    const conduces = indice.find((e) => e.ruta === '/inventario/conduces');
    expect(conduces?.camino).toBe('Inventario › Conduces');
  });

  it('un grupo oculto (canAccess=false) no aporta NINGUNA fila, ni la suya ni la de sus hijos', () => {
    const indice = construirIndiceMenu(ARBOL, {
      canAccess: (item) => item.label !== 'Inventario',
      canAccessChild: () => true,
    });
    expect(indice.some((e) => e.ruta.startsWith('/inventario'))).toBe(false);
  });

  it('respeta canAccessChild por hijo aunque el grupo sea visible (showIfAnyChild)', () => {
    const indice = construirIndiceMenu(ARBOL, {
      canAccess: () => true,
      // Solo "esDesarrollador" ve Dev notes, aunque el usuario SÍ sea "esTecnologia"
      // (y por tanto vea el grupo Developer).
      canAccessChild: (child) => !child.soloDesarrollador,
    });
    expect(indice.some((e) => e.ruta === '/tecnologia/dev-notes')).toBe(false);
  });

  it('aplica la traducción (t) ANTES de construir título y camino', () => {
    const indice = construirIndiceMenu(ARBOL, {
      canAccess: () => true,
      canAccessChild: () => true,
      t: (s) => (s === 'Conduces' ? 'Waybills' : s === 'Inventario' ? 'Inventory' : s),
    });
    const conduces = indice.find((e) => e.ruta === '/inventario/conduces');
    expect(conduces?.titulo).toBe('Waybills');
    expect(conduces?.camino).toBe('Inventory › Waybills');
  });

  it('no incluye ítems con `phase` (fase bloqueada, no navegable)', () => {
    const conFase: NavItem[] = [{ label: 'Futuro', icon: 'x', route: '/futuro', phase: 'Próximamente' }];
    const indice = construirIndiceMenu(conFase, { canAccess: () => true, canAccessChild: () => true });
    expect(indice).toEqual([]);
  });
});

describe('moduloActualDesdeRuta (DG — Compa flotante, "en <módulo>")', () => {
  const indice = construirIndiceMenu(ARBOL, { canAccess: () => true, canAccessChild: () => true });

  it('match exacto de una pantalla de primer nivel', () => {
    expect(moduloActualDesdeRuta('/dashboard', indice)).toBe('Dashboard');
  });

  it('match exacto de un hijo: devuelve el grupo padre, no el hijo', () => {
    expect(moduloActualDesdeRuta('/inventario/conduces', indice)).toBe('Inventario');
  });

  it('match por prefijo (pantalla con parámetro, p. ej. detalle con :id)', () => {
    expect(moduloActualDesdeRuta('/inventario/conduces/CND-00123', indice)).toBe('Inventario');
  });

  it('elige el prefijo MÁS LARGO cuando hay varias rutas candidatas', () => {
    const indiceConSolape: ReturnType<typeof construirIndiceMenu> = [
      ...indice,
      { id: 'nav:/inventario', titulo: 'Resumen', ruta: '/inventario', camino: 'Resumen', palabrasClave: [], esModulo: false },
    ];
    // '/inventario/conduces/123' matchea tanto '/inventario' como '/inventario/conduces';
    // debe ganar el más específico.
    expect(moduloActualDesdeRuta('/inventario/conduces/123', indiceConSolape)).toBe('Inventario');
  });

  it('ninguna coincidencia → null (no inventa un módulo)', () => {
    expect(moduloActualDesdeRuta('/auth', indice)).toBeNull();
  });
});
