// Tutorial "Aprobar y despachar una requisición".
export const SCREEN = 'aprobar-despachar';
export const TITULO = 'Aprobar y despachar una requisición';

export const PASOS = [
  { fase: 0, cap: 'Inventario → Requisiciones', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'Cuando llega una requisición, alguien tiene que atenderla. Entra a Inventario y abre Requisiciones.' },
  { fase: 1, cap: 'Abre la pendiente y toca «Atender»', cam: { x: 1680, y: 360, s: 1.5 }, click: true,
    voz: 'Busca la requisición que está pendiente y haz clic en Atender.' },
  { fase: 2, cap: 'Elige el almacén de origen', cam: { x: 1560, y: 300, s: 1.4 }, click: true,
    voz: 'Se abre el detalle. Lo primero es elegir desde qué almacén vas a despachar el material.' },
  { fase: 3, cap: 'Almacén Central', cam: { x: 1560, y: 300, s: 1.4 },
    voz: 'En este ejemplo despachamos desde el Almacén Central.' },
  { fase: 4, cap: 'Despacha lo disponible', cam: { x: 1560, y: 500, s: 1.3 },
    voz: 'El sistema te muestra cuánto hay de cada material. Despachas lo que está disponible.' },
  { fase: 5, cap: 'Lo que falta va a compra', cam: { x: 1560, y: 600, s: 1.4 },
    voz: 'Si de algún material no alcanza, lo que falta se pide en compra, automáticamente.' },
  { fase: 6, cap: 'Aprobar y despachar', cam: { x: 1560, y: 830, s: 1.5 }, click: true,
    voz: 'Cuando todo esté listo, haz clic en Aprobar y despachar.' },
  { fase: 7, cap: '¡Despachada!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! Se despachó el material y se generó el conduce para transportarlo a la obra.' },
];
