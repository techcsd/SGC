// CS4 — interpreta un user_agent crudo (auth.sessions.user_agent) a una etiqueta
// legible "Chrome en Windows" / "App Android" / "Safari en iPhone", sin libs
// externas (suficiente para distinguir dispositivos en una lista corta).

function sistema(ua: string): string | null {
  if (/android/i.test(ua)) return 'Android';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return null;
}

function navegador(ua: string): string | null {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua) && !/headlesschrome/i.test(ua)) return 'Chrome';
  if (/headlesschrome/i.test(ua)) return 'Chrome (automatizado)';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  return null;
}

/** Etiqueta legible del dispositivo/sesión a partir del user_agent crudo. */
export function dispositivoLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Dispositivo desconocido';
  if (/claude|anthropic/i.test(ua)) return 'Claude Desktop';
  if (/csd-app|okhttp|dart|flutter/i.test(ua)) return 'App móvil (CSD)';
  const sys = sistema(ua);
  const nav = navegador(ua);
  if (sys === 'iPhone' && nav) return `${nav} en iPhone`;
  if (sys === 'iPad' && nav) return `${nav} en iPad`;
  if (nav && sys) return `${nav} en ${sys}`;
  if (nav) return nav;
  if (sys) return sys;
  return 'Dispositivo desconocido';
}
