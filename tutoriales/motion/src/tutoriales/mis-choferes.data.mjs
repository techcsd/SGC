// Tutorial "Mis choferes" — panel de estado + asignar ruta.
export const SCREEN = 'mis-choferes';
export const TITULO = 'Ver y asignar tus choferes';

export const PASOS = [
  { fase: 0, cap: 'Transporte → Mis choferes', cam: { x: 1050, y: 440, s: 1.0 },
    voz: 'En Mis choferes ves el estado de tu equipo en tiempo real. Entra a Transporte y abre Mis choferes.' },
  { fase: 1, cap: 'Juan — Disponible', cam: { x: 560, y: 410, s: 1.5 },
    voz: 'Juan está disponible, listo para salir a una ruta.' },
  { fase: 2, cap: 'Pedro — En ruta', cam: { x: 1060, y: 410, s: 1.5 },
    voz: 'Pedro está en ruta, llevando material a Torre Norte.' },
  { fase: 3, cap: 'Carlos — Descansando', cam: { x: 1560, y: 410, s: 1.5 },
    voz: 'Y Carlos está descansando hoy.' },
  { fase: 4, cap: 'Asigna una ruta', cam: { x: 560, y: 560, s: 1.6 }, click: true,
    voz: 'Para darle una ruta a Juan, haz clic en Asignar ruta.' },
  { fase: 5, cap: '¡Ruta asignada!', cam: { x: 1050, y: 440, s: 1.05 },
    voz: '¡Listo! La ruta le llega al chofer en su teléfono al instante.' },
];
