// Instalar la CSD App en Android (APK): enlace WhatsApp → Descargar APK → aviso de Chrome
// → Abrir → permiso de fuente → Instalar → entrar → avisos. Pasos FIELES al mock CM1.
export const SCREEN = 'android';
export const TITULO = 'Instalar la CSD App en Android';

export const PASOS = [
  { fase: 0, cap: 'Instala la CSD App en tu Android', cam: { x: 960, y: 528, s: 1.0 },
    voz: 'Te enseño a instalar la CSD App en tu Android. Es rápido.' },
  { fase: 1, cap: 'Toca «Descargar APK»', cam: { x: 960, y: 820, s: 1.35 }, click: true,
    voz: 'Abre el enlace que te llegó por WhatsApp y toca Descargar APK.' },
  { fase: 2, cap: 'Toca «Descargar de todas formas»', cam: { x: 960, y: 860, s: 1.35 }, click: true,
    voz: 'Chrome avisa siempre con los APK. Es la app de la empresa: toca Descargar de todas formas.' },
  { fase: 3, cap: 'Toca «Abrir»', cam: { x: 960, y: 210, s: 1.4 }, click: true,
    voz: 'Cuando termine, toca Abrir.' },
  { fase: 4, cap: 'Activa «Permitir de esta fuente»', cam: { x: 960, y: 540, s: 1.4 }, click: true,
    voz: 'La primera vez el teléfono pide permiso. Activa Permitir de esta fuente y regresa.' },
  { fase: 5, cap: 'Toca «Instalar»', cam: { x: 960, y: 860, s: 1.35 }, click: true,
    voz: 'Toca Instalar y espera unos segundos.' },
  { fase: 6, cap: 'Entra con tu usuario, o tu cédula y PIN', cam: { x: 960, y: 770, s: 1.15 }, click: true,
    voz: 'Ábrela y entra con tu usuario, o con tu cédula y tu PIN.' },
  { fase: 7, cap: '¿Ya la tenías? Instala encima: no se borra nada', cam: { x: 960, y: 528, s: 1.0 },
    voz: 'Acepta los avisos y la ubicación para que te lleguen tus trabajos. ¡Listo!' },
];
