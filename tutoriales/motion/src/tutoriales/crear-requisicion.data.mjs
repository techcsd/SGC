// Tutorial "Crear una requisición" — coreografía (datos). Node (síntesis de voz) y el
// bundle (composición) leen este archivo. `cam` = punto del mundo 1920x1080 + zoom.
// `fase` = estado de la pantalla mock (0..N). `voz` = narración es-DO (Ramona).
export const SCREEN = 'crear-requisicion';
export const TITULO = 'Crear una requisición';

export const PASOS = [
  { fase: 0, cap: 'Inventario → Requisiciones', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Te voy a enseñar a crear una requisición para pedir material. Entra al módulo de Inventario y abre Requisiciones.' },
  { fase: 1, cap: 'Toca «Nueva requisición»', cam: { x: 1640, y: 205, s: 1.55 }, click: true,
    voz: 'Arriba a la derecha, haz clic en el botón de Nueva requisición.' },
  { fase: 2, cap: 'Elige la obra', cam: { x: 1560, y: 250, s: 1.35 }, click: true,
    voz: 'Se abre el formulario. Lo primero es elegir la obra para la que estás pidiendo el material.' },
  { fase: 3, cap: 'Obra: Torre Norte', cam: { x: 1560, y: 250, s: 1.4 },
    voz: 'En este ejemplo elegimos la obra Torre Norte.' },
  { fase: 4, cap: 'Agrega el material', cam: { x: 1560, y: 430, s: 1.35 }, click: true,
    voz: 'Ahora agrega el material que necesitas. Vamos a pedir cemento.' },
  { fase: 5, cap: 'Escribe la cantidad', cam: { x: 1680, y: 430, s: 1.6 },
    voz: 'Escribe la cantidad: cien sacos de cemento.' },
  { fase: 6, cap: 'Fecha y motivo', cam: { x: 1560, y: 640, s: 1.3 },
    voz: 'Indica para cuándo lo necesitas y explica el motivo, así se aprueba más rápido.' },
  { fase: 7, cap: 'Envía la requisición', cam: { x: 1560, y: 880, s: 1.5 }, click: true,
    voz: 'Y por último, haz clic en Enviar requisición.' },
  { fase: 8, cap: '¡Requisición creada!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! Tu requisición quedó creada y va directo para aprobación. Así de fácil.' },
];
