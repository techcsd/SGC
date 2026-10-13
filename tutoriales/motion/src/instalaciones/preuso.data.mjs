// Tutorial "Pre-uso del vehículo" (app móvil, teléfono) — voz es-DO (Ramona).
export const SCREEN = 'preuso';
export const TITULO = 'Pre-uso del vehículo (app)';

export const PASOS = [
  { fase: 0, cap: 'Pre-uso del vehículo', cam: { x: 960, y: 528, s: 1.0 },
    voz: 'Antes de usar el vehículo, haz el pre-uso en la CSD App. Te enseño: es rápido.' },
  { fase: 1, cap: 'Tu vehículo asignado', cam: { x: 960, y: 300, s: 1.25 }, click: true,
    voz: 'La app te muestra tu vehículo asignado. Toca Empezar la inspección.' },
  { fase: 2, cap: 'Marca «Luces: bien»', cam: { x: 960, y: 430, s: 1.4 }, click: true,
    voz: 'Revisa las luces y, si están bien, márcalas.' },
  { fase: 3, cap: 'Marca «Llantas: bien»', cam: { x: 960, y: 530, s: 1.4 }, click: true,
    voz: 'Revisa las llantas y márcalas.' },
  { fase: 4, cap: 'Frenos y aceite', cam: { x: 960, y: 630, s: 1.4 }, click: true,
    voz: 'Revisa los frenos y el aceite, y márcalos. Si algo está mal, anótalo ahí mismo.' },
  { fase: 5, cap: 'Foto del tablero', cam: { x: 960, y: 740, s: 1.35 }, click: true,
    voz: 'Toma la foto del tablero con el kilometraje.' },
  { fase: 6, cap: 'Envía el pre-uso', cam: { x: 960, y: 860, s: 1.45 }, click: true,
    voz: 'Y toca Enviar pre-uso.' },
  { fase: 7, cap: '¡Listo!', cam: { x: 960, y: 528, s: 1.0 },
    voz: '¡Listo! Ya puedes usar el vehículo con tranquilidad. El pre-uso queda registrado.' },
];
