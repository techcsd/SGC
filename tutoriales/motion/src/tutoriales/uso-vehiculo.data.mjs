// Tutorial "Uso de vehículo: tomar y soltar" — coreografía (datos). Voz es-DO (Ramona).
export const SCREEN = 'uso-vehiculo';
export const TITULO = 'Uso de vehículo: tomar y soltar';

export const PASOS = [
  { fase: 0, cap: 'Flota → Responsabilidad', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Te enseño a tomar un vehículo y a soltarlo cuando termines. Entra a Flota y abre Responsabilidad de vehículos.' },
  { fase: 1, cap: 'Toca «Tomar un vehículo»', cam: { x: 1640, y: 205, s: 1.55 }, click: true,
    voz: 'Arriba a la derecha, toca Tomar un vehículo.' },
  { fase: 2, cap: 'Elige el vehículo', cam: { x: 1560, y: 250, s: 1.4 }, click: true,
    voz: 'Elige el vehículo que vas a usar.' },
  { fase: 3, cap: 'Kilometraje de salida', cam: { x: 1560, y: 370, s: 1.45 },
    voz: 'Anota el kilometraje con el que lo recibes.' },
  { fase: 4, cap: 'Revisa el estado', cam: { x: 1560, y: 500, s: 1.4 },
    voz: 'Revisa el estado: luces, llantas, aceite. Si algo está mal, déjalo anotado.' },
  { fase: 5, cap: 'Firma que lo recibes', cam: { x: 1560, y: 650, s: 1.4 },
    voz: 'Firma con el dedo para dejar claro que tú lo recibiste.' },
  { fase: 6, cap: 'Confirma', cam: { x: 1560, y: 860, s: 1.5 }, click: true,
    voz: 'Toca Tomar vehículo. A partir de ahí, eres el responsable.' },
  { fase: 7, cap: '¡Tomado! Al terminar, lo sueltas igual', cam: { x: 1000, y: 300, s: 1.1 },
    voz: 'Listo, el vehículo queda a tu nombre. Cuando termines, aquí mismo lo sueltas: anotas el kilometraje final y lo entregas. ¡Así de fácil!' },
];
