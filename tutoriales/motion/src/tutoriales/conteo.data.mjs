// Tutorial "Hacer un conteo" físico de inventario.
export const SCREEN = 'conteo';
export const TITULO = 'Hacer un conteo';

export const PASOS = [
  { fase: 0, cap: 'Inventario → Conteos', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'El conteo físico sirve para cuadrar lo que dice el sistema con lo que hay de verdad en el almacén. Entra a Inventario y abre Conteos.' },
  { fase: 1, cap: 'Toca «Nuevo conteo»', cam: { x: 1680, y: 205, s: 1.5 }, click: true,
    voz: 'Haz clic en Nuevo conteo.' },
  { fase: 2, cap: 'Cuenta y anota lo real', cam: { x: 980, y: 430, s: 1.08 },
    voz: 'Aquí ves cada material con la cantidad que el sistema cree que hay. Vas a contar y anotar lo que hay de verdad.' },
  { fase: 3, cap: 'Cemento: 315', cam: { x: 900, y: 360, s: 1.28 },
    voz: 'Cuenta el cemento y escribe lo que contaste: trescientos quince sacos.' },
  { fase: 4, cap: 'Varilla: 540', cam: { x: 900, y: 445, s: 1.28 },
    voz: 'Sigue con la varilla: quinientos cuarenta, igual que el sistema.' },
  { fase: 5, cap: 'Bloques: 1180 (faltan 20)', cam: { x: 900, y: 540, s: 1.26 },
    voz: 'Y los bloques: contaste mil ciento ochenta. Faltan veinte, así que lo explicas en la observación.' },
  { fase: 6, cap: 'Cierra el conteo', cam: { x: 520, y: 815, s: 1.35 }, click: true,
    voz: 'Cuando termines, cierra el conteo.' },
  { fase: 7, cap: '¡Conteo cerrado!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! El sistema ajusta las diferencias y tu inventario queda cuadrado con la realidad.' },
];
