// Tutorial "Transferir un conduce" (cambia de chofer + deja receptor).
export const SCREEN = 'transferir-conduce';
export const TITULO = 'Transferir un conduce';

export const PASOS = [
  { fase: 0, cap: 'Transporte → Conduces', cam: { x: 1000, y: 470, s: 1.0 },
    voz: 'A veces un conduce tiene que cambiar de chofer en el camino. Entra a Transporte y abre Conduces.' },
  { fase: 1, cap: 'Abre el conduce y toca «Transferir»', cam: { x: 1700, y: 360, s: 1.5 }, click: true,
    voz: 'Busca el conduce que vas a mover y haz clic en Transferir.' },
  { fase: 2, cap: 'Elige el nuevo chofer', cam: { x: 1560, y: 285, s: 1.4 }, click: true,
    voz: 'Se abre el panel de transferencia. Primero elige el nuevo chofer que lo va a llevar.' },
  { fase: 3, cap: 'Chofer: Juan Pérez', cam: { x: 1560, y: 285, s: 1.4 },
    voz: 'En este ejemplo lo transferimos a Juan Pérez.' },
  { fase: 4, cap: 'Indica quién lo recibe', cam: { x: 1560, y: 430, s: 1.4 }, click: true,
    voz: 'Muy importante: indica quién va a recibir el material en la obra, para que pueda firmar al llegar.' },
  { fase: 5, cap: 'Escribe el motivo', cam: { x: 1560, y: 585, s: 1.35 },
    voz: 'Escribe el motivo del cambio, así queda el rastro de por qué cambió de chofer.' },
  { fase: 6, cap: 'Confirma la transferencia', cam: { x: 1560, y: 775, s: 1.5 }, click: true,
    voz: 'Y por último, confirma la transferencia.' },
  { fase: 7, cap: '¡Conduce transferido!', cam: { x: 1000, y: 470, s: 1.05 },
    voz: '¡Listo! El conduce quedó en manos de Juan Pérez, con su receptor listo para firmar.' },
];
