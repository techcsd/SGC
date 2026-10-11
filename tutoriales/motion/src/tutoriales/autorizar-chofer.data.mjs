// Tutorial "Autorizar un chofer privado" a un vehículo.
export const SCREEN = 'autorizar-chofer';
export const TITULO = 'Autorizar un chofer privado';

export const PASOS = [
  { fase: 0, cap: 'Flota → Choferes privados', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Los choferes privados solo pueden usar los vehículos que tú autorices. Entra a Flota y abre Choferes privados.' },
  { fase: 1, cap: 'Abre el chofer y toca «Autorizar vehículo»', cam: { x: 1700, y: 360, s: 1.5 }, click: true,
    voz: 'Busca al chofer y haz clic en Autorizar vehículo.' },
  { fase: 2, cap: 'Elige el vehículo', cam: { x: 1560, y: 280, s: 1.4 }, click: true,
    voz: 'Elige el vehículo que le vas a autorizar.' },
  { fase: 3, cap: 'Pon la vigencia', cam: { x: 1560, y: 420, s: 1.4 },
    voz: 'Define hasta cuándo está autorizado. Al vencer, se bloquea solo.' },
  { fase: 4, cap: 'Autorizar', cam: { x: 1560, y: 620, s: 1.5 }, click: true,
    voz: 'Y confirma la autorización.' },
  { fase: 5, cap: '¡Chofer autorizado!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! Ahora el chofer puede usar ese vehículo, dentro de la vigencia que pusiste.' },
];
