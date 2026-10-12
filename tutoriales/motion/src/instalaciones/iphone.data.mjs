// Instalar la CSD App en iPhone (PWA): Safari → app.sgcconstructorasd.com → Compartir →
// Añadir a pantalla de inicio → nombre CSD App → ícono → entrar. Pasos FIELES al mock CM1.
export const SCREEN = 'iphone';
export const TITULO = 'Instalar la CSD App en iPhone';

export const PASOS = [
  { fase: 0, cap: 'Instala la CSD App en tu iPhone', cam: { x: 960, y: 528, s: 1.0 },
    voz: 'En iPhone la CSD App se instala desde Safari. Te enseño.' },
  { fase: 1, cap: 'En Safari, abre app.sgcconstructorasd.com', cam: { x: 960, y: 170, s: 1.3 }, click: true,
    voz: 'Abre Safari, no Chrome, y entra a app punto sgcconstructorasd punto com.' },
  { fase: 2, cap: 'Toca el botón Compartir', cam: { x: 960, y: 930, s: 1.4 }, click: true,
    voz: 'Abajo, toca el botón Compartir: el cuadrito con la flecha hacia arriba.' },
  { fase: 3, cap: 'Toca «Añadir a pantalla de inicio»', cam: { x: 960, y: 560, s: 1.3 }, click: true,
    voz: 'Baja un poco y toca Añadir a pantalla de inicio.' },
  { fase: 4, cap: 'Deja «CSD App» y toca Añadir', cam: { x: 960, y: 200, s: 1.4 }, click: true,
    voz: 'Deja el nombre CSD App y toca Añadir.' },
  { fase: 5, cap: 'Abre la app desde su ícono', cam: { x: 900, y: 430, s: 1.5 }, click: true,
    voz: 'Ya tienes el ícono. Ábrela siempre desde aquí, no desde Safari.' },
  { fase: 6, cap: 'Entra y permite los avisos', cam: { x: 960, y: 760, s: 1.15 }, click: true,
    voz: 'Entra con tu usuario y permite los avisos.' },
  { fase: 7, cap: 'Ya está instalada · Dudas › Instalar', cam: { x: 960, y: 528, s: 1.0 },
    voz: '¡Listo! Si te trabas, mira este video otra vez en Dudas.' },
];
