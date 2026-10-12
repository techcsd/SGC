/**
 * CN4 — perfil de bienvenida por rol (lógica pura, sin dependencias de Angular, para que
 * se pueda probar sin TestBed). El ORDEN es la PRIORIDAD (primer match gana): un usuario
 * con varios roles cae en el más autoritativo (admin antes que todo). Códigos reales de
 * `sgc.roles`. Esta tabla es el **contrato** que la app (csd-app) copia idéntico
 * (ver PARIDAD.md) — su bug era saludar a un admin como "ingeniero".
 */
export interface Perfil { modulo: string; que: string; }

export const PERFILES: { codigos: string[]; p: Perfil }[] = [
  { codigos: ['admin'], p: { modulo: 'Administración', que: 'todo el sistema: usuarios, roles y configuración' } },
  { codigos: ['direccion', 'gerencia'], p: { modulo: 'Dirección', que: 'los indicadores y el avance de los proyectos' } },
  { codigos: ['desarrollador', 'encargado_tecnologia', 'tecnologia'], p: { modulo: 'Tecnología', que: 'reportes, QA, issues y la configuración técnica' } },
  { codigos: ['abogado'], p: { modulo: 'Legal', que: 'expedientes, contratos, aprobaciones y firmas' } },
  { codigos: ['jefe_rrhh'], p: { modulo: 'RRHH', que: 'empleados, asistencia, ausencias y vacaciones' } },
  { codigos: ['coord_compras'], p: { modulo: 'Compras', que: 'solicitudes de materiales y órdenes de compra' } },
  { codigos: ['jefe_flota'], p: { modulo: 'Flota', que: 'tus vehículos, rutas, combustible y mantenimientos' } },
  { codigos: ['logistica'], p: { modulo: 'Transporte', que: 'conduces, requisiciones y el apoyo de transporte' } },
  { codigos: ['gerente_proyectos', 'jefe_ingenieros'], p: { modulo: 'Proyectos', que: 'tus obras, el avance y el ranking de encargados' } },
  { codigos: ['gerente_produccion', 'ingeniero_campo', 'ingeniero_oficina', 'capataz'], p: { modulo: 'Obra', que: 'tu bitácora, requisiciones y personal de obra' } },
  { codigos: ['encargado_patio', 'guarda_almacen'], p: { modulo: 'Inventario', que: 'entradas, salidas, conduces y conteos' } },
  { codigos: ['chofer_transportista', 'chofer_privado'], p: { modulo: 'Transporte', que: 'tus rutas, conduces y combustible' } },
  { codigos: ['revisor_tiendas'], p: { modulo: 'Ayuda', que: 'cómo funciona la app con datos de demostración' } },
];

export const PERFIL_DEFAULT: Perfil = { modulo: 'tu módulo', que: 'tu trabajo del día a día' };

/** CN4 — resuelve el perfil de bienvenida a partir de los roles (primer match por prioridad). */
export function resolverPerfil(roles: readonly string[]): Perfil {
  for (const { codigos, p } of PERFILES) if (codigos.some((c) => roles.includes(c))) return p;
  return PERFIL_DEFAULT;
}
