// Instalación en Android (descargar APK + permitir fuente + instalar + abrir).
export const SCREEN = 'android';
export const TITULO = 'Instalar SGC en Android';

export const PASOS = [
  { fase: 0, cap: 'Abre sgcconstructorasd.com', cam: { x: 960, y: 540, s: 1.0 },
    voz: 'Para instalar SGC en Android, abre sgcconstructorasd.com en tu teléfono, o escanea el código QR, y entra a la sección App móvil.' },
  { fase: 1, cap: 'Toca «Descargar APK»', cam: { x: 960, y: 820, s: 1.5 }, click: true,
    voz: 'Toca el botón Descargar APK.' },
  { fase: 2, cap: 'Permite e instala', cam: { x: 960, y: 895, s: 1.5 }, click: true,
    voz: 'El teléfono te preguntará si quieres instalarla. Si te pide permiso para esta fuente, acéptalo, y toca Instalar.' },
  { fase: 3, cap: 'Espera a que instale', cam: { x: 960, y: 560, s: 1.3 },
    voz: 'Espera unos segundos mientras se instala.' },
  { fase: 4, cap: 'Abre el ícono de SGC', cam: { x: 862, y: 360, s: 1.6 }, click: true,
    voz: 'Cuando termine, busca el ícono de SGC en tu pantalla y ábrelo.' },
  { fase: 5, cap: '¡Listo!', cam: { x: 960, y: 540, s: 1.0 },
    voz: '¡Listo! Ya tienes SGC en tu teléfono. Entra con tu usuario y a trabajar.' },
];
