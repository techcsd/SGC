// Tutorial "Crear un conduce" (emitir conduce para transportar material).
export const SCREEN = 'crear-conduce';
export const TITULO = 'Crear un conduce';

export const PASOS = [
  { fase: 0, cap: 'Transporte → Conduces', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Un conduce documenta el traslado del material hasta la obra. Vamos a crear uno. Entra a Transporte y abre Conduces.' },
  { fase: 1, cap: 'Toca «Nuevo conduce»', cam: { x: 1680, y: 205, s: 1.5 }, click: true,
    voz: 'Arriba a la derecha, haz clic en Nuevo conduce.' },
  { fase: 2, cap: 'Almacén de origen', cam: { x: 1560, y: 250, s: 1.4 }, click: true,
    voz: 'Elige desde qué almacén sale el material.' },
  { fase: 3, cap: 'Obra destino', cam: { x: 1560, y: 375, s: 1.4 }, click: true,
    voz: 'Elige la obra a la que va.' },
  { fase: 4, cap: 'Asigna el chofer', cam: { x: 1560, y: 500, s: 1.4 }, click: true,
    voz: 'Asigna el chofer que va a llevarlo.' },
  { fase: 5, cap: 'Agrega el material', cam: { x: 1560, y: 640, s: 1.35 }, click: true,
    voz: 'Agrega el material y la cantidad que se va a transportar.' },
  { fase: 6, cap: 'Emitir conduce', cam: { x: 1560, y: 850, s: 1.5 }, click: true,
    voz: 'Y por último, emite el conduce.' },
  { fase: 7, cap: '¡Conduce emitido!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! El conduce quedó emitido y el chofer ya puede salir con el material.' },
];
