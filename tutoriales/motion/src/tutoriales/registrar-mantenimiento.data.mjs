// Tutorial "Registrar un mantenimiento" de vehículo.
export const SCREEN = 'registrar-mantenimiento';
export const TITULO = 'Registrar un mantenimiento';

export const PASOS = [
  { fase: 0, cap: 'Flota → Mantenimientos', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Lleva al día el mantenimiento de tus vehículos. Entra a Flota y abre Mantenimientos.' },
  { fase: 1, cap: 'Toca «Nuevo mantenimiento»', cam: { x: 1660, y: 205, s: 1.5 }, click: true,
    voz: 'Haz clic en Nuevo mantenimiento.' },
  { fase: 2, cap: 'Elige el vehículo', cam: { x: 1560, y: 250, s: 1.4 }, click: true,
    voz: 'Elige el vehículo al que le vas a registrar el mantenimiento.' },
  { fase: 3, cap: 'Tipo y taller', cam: { x: 1560, y: 375, s: 1.4 }, click: true,
    voz: 'Indica el tipo de mantenimiento y el taller donde se hizo.' },
  { fase: 4, cap: 'Kilometraje actual', cam: { x: 1560, y: 500, s: 1.45 },
    voz: 'Anota el kilometraje actual del vehículo. El sistema te avisa si no cuadra.' },
  { fase: 5, cap: 'Detalle y costo', cam: { x: 1560, y: 640, s: 1.35 },
    voz: 'Escribe qué se hizo y cuánto costó.' },
  { fase: 6, cap: 'Guardar', cam: { x: 1560, y: 840, s: 1.5 }, click: true,
    voz: 'Y guarda el mantenimiento.' },
  { fase: 7, cap: '¡Mantenimiento registrado!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! Quedó registrado en el historial del vehículo.' },
];
