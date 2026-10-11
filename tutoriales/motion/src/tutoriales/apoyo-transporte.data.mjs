// Tutorial "Pedir apoyo de transporte".
export const SCREEN = 'apoyo-transporte';
export const TITULO = 'Pedir apoyo de transporte';

export const PASOS = [
  { fase: 0, cap: 'Transporte → Apoyo', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Cuando necesitas mover material y no hay vehículo propio disponible, pides apoyo de transporte. Entra a Transporte y abre Apoyo.' },
  { fase: 1, cap: 'Toca «Nueva solicitud»', cam: { x: 1660, y: 205, s: 1.5 }, click: true,
    voz: 'Haz clic en Nueva solicitud.' },
  { fase: 2, cap: 'Punto de origen', cam: { x: 1560, y: 250, s: 1.4 }, click: true,
    voz: 'Indica desde dónde sale la carga.' },
  { fase: 3, cap: 'Destino', cam: { x: 1560, y: 375, s: 1.4 }, click: true,
    voz: 'Y a qué obra va.' },
  { fase: 4, cap: 'Qué se mueve', cam: { x: 1560, y: 510, s: 1.4 },
    voz: 'Describe qué se va a mover, para que el transportista sepa qué lleva.' },
  { fase: 5, cap: 'Enviar solicitud', cam: { x: 1560, y: 700, s: 1.5 }, click: true,
    voz: 'Y envía la solicitud.' },
  { fase: 6, cap: '¡Solicitud enviada!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! La solicitud le llega a transporte para que te asignen un vehículo.' },
];
