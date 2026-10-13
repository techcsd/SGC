// Tutorial "Registrar combustible" — coreografía (datos). Voz es-DO (Ramona).
export const SCREEN = 'registrar-combustible';
export const TITULO = 'Registrar combustible';

export const PASOS = [
  { fase: 0, cap: 'Flota → Combustible', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Te enseño a registrar una echada de combustible. Entra al módulo de Flota y abre Combustible.' },
  { fase: 1, cap: 'Toca «Registrar combustible»', cam: { x: 1640, y: 205, s: 1.55 }, click: true,
    voz: 'Arriba a la derecha, haz clic en Registrar combustible.' },
  { fase: 2, cap: 'Elige el vehículo', cam: { x: 1560, y: 250, s: 1.4 }, click: true,
    voz: 'Se abre el formulario. Primero elige el vehículo al que le echaste el combustible.' },
  { fase: 3, cap: 'Escribe los galones', cam: { x: 1560, y: 370, s: 1.45 },
    voz: 'Escribe cuántos galones echaste. En este ejemplo, doce galones y medio.' },
  { fase: 4, cap: 'Escribe el monto', cam: { x: 1560, y: 490, s: 1.45 },
    voz: 'Pon el monto que pagaste, en pesos.' },
  { fase: 5, cap: 'El kilometraje del tablero', cam: { x: 1560, y: 610, s: 1.45 },
    voz: 'Y muy importante: el kilometraje que marca el tablero. No puede ser menor al anterior.' },
  { fase: 6, cap: 'Guarda la echada', cam: { x: 1560, y: 860, s: 1.5 }, click: true,
    voz: 'Sube la foto del recibo y del tablero, y toca Guardar.' },
  { fase: 7, cap: '¡Registrado!', cam: { x: 1000, y: 300, s: 1.1 },
    voz: '¡Listo! La echada queda registrada con su rendimiento. Así de fácil.' },
];
