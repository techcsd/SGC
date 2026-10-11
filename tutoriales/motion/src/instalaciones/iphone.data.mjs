// Instalación en iPhone (Safari → Compartir → Agregar a pantalla de inicio).
export const SCREEN = 'iphone';
export const TITULO = 'Instalar SGC en iPhone';

export const PASOS = [
  { fase: 0, cap: 'Ábrela en Safari', cam: { x: 960, y: 540, s: 1.0 },
    voz: 'Para instalar SGC en iPhone, abre sgcconstructorasd.com en Safari.' },
  { fase: 1, cap: 'Toca Compartir', cam: { x: 960, y: 945, s: 1.5 }, click: true,
    voz: 'Toca el botón de Compartir, abajo en la barra de Safari.' },
  { fase: 2, cap: '«Agregar a pantalla de inicio»', cam: { x: 960, y: 690, s: 1.4 }, click: true,
    voz: 'En el menú, baja y toca Agregar a pantalla de inicio.' },
  { fase: 3, cap: 'Confirma con «Agregar»', cam: { x: 1090, y: 200, s: 1.5 }, click: true,
    voz: 'Confirma tocando Agregar, arriba a la derecha.' },
  { fase: 4, cap: 'Abre el ícono de SGC', cam: { x: 862, y: 360, s: 1.6 }, click: true,
    voz: 'Ya aparece el ícono de SGC en tu pantalla de inicio. Ábrelo.' },
  { fase: 5, cap: '¡Listo!', cam: { x: 960, y: 540, s: 1.0 },
    voz: '¡Listo! SGC queda instalada como una app. Entra con tu usuario y a trabajar.' },
];
