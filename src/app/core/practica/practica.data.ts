import { MisionPractica } from './practica.model';

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

/** Piloto: "Crear una requisición". Objetivos que suman 100. */
export const MISION_CREAR_REQUISICION: MisionPractica = {
  id: 'web-crear-requisicion',
  plataforma: 'web',
  roles: [],
  titulo: 'Crear una requisición',
  intro: 'Practica cómo pedir material para una obra. Nada de esto es real — es para que aprendas el flujo sin miedo a equivocarte.',
  version: 1,
  objetivos: [
    { id: 'obra', texto: 'Elegiste la obra', puntos: 20, cumple: (r) => !!r['obraId'], consejo: 'Toda requisición es para una obra.' },
    { id: 'items', texto: 'Agregaste al menos un material', puntos: 25, cumple: (r) => Array.isArray(r['items']) && (r['items'] as unknown[]).length > 0, consejo: 'Agrega los materiales que necesitas.' },
    { id: 'cantidades', texto: 'Todas las cantidades son mayores a 0', puntos: 20,
      cumple: (r) => Array.isArray(r['items']) && (r['items'] as { cantidad: number }[]).length > 0 && (r['items'] as { cantidad: number }[]).every((i) => i.cantidad > 0),
      consejo: 'Una cantidad en 0 no pide nada.' },
    { id: 'necesidad', texto: 'Pusiste la fecha de necesidad', puntos: 15, cumple: (r) => !!r['fechaNecesidad'], consejo: 'La fecha ayuda a priorizar la compra.' },
    { id: 'justifica', texto: 'Escribiste el motivo / para qué', puntos: 20, cumple: (r) => !!(r['motivo'] as string)?.trim(), consejo: 'Explica para qué es, así se aprueba más rápido.' },
  ],
  penalizaciones: [
    { id: 'sobre-stock', texto: 'Pediste más de lo que hay en stock de algún material', puntos: 10,
      aplica: (r) => Array.isArray(r['items']) && (r['items'] as { stock: number; cantidad: number }[]).some((i) => i.cantidad > i.stock) },
  ],
};

export const MISIONES_PILOTO: MisionPractica[] = [MISION_CREAR_REQUISICION];
