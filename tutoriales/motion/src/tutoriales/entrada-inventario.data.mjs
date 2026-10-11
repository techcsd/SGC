// Tutorial "Registrar una entrada de inventario".
export const SCREEN = 'entrada-inventario';
export const TITULO = 'Registrar una entrada de inventario';

export const PASOS = [
  { fase: 0, cap: 'Inventario → Entradas', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Cuando llega material de un proveedor, le das entrada al inventario. Entra a Inventario y abre Entradas.' },
  { fase: 1, cap: 'Toca «Nueva entrada»', cam: { x: 1680, y: 205, s: 1.5 }, click: true,
    voz: 'Arriba, haz clic en Nueva entrada.' },
  { fase: 2, cap: 'Elige el origen', cam: { x: 1560, y: 255, s: 1.4 }, click: true,
    voz: 'Elige de dónde viene el material. En este caso, de un conduce externo del proveedor.' },
  { fase: 3, cap: 'Almacén destino', cam: { x: 1560, y: 375, s: 1.4 }, click: true,
    voz: 'Elige el almacén donde va a entrar el material.' },
  { fase: 4, cap: 'Agrega el material que llegó', cam: { x: 1560, y: 520, s: 1.35 }, click: true,
    voz: 'Agrega el material que recibiste, con la cantidad real que llegó.' },
  { fase: 5, cap: 'Fecha de recepción', cam: { x: 1560, y: 660, s: 1.35 },
    voz: 'Pon la fecha en que lo recibiste.' },
  { fase: 6, cap: 'Registrar entrada', cam: { x: 1560, y: 840, s: 1.5 }, click: true,
    voz: 'Y por último, registra la entrada.' },
  { fase: 7, cap: '¡Entrada registrada!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! El material ya está sumado a tu inventario, listo para usarse.' },
];
