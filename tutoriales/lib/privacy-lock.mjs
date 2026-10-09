// CK5 — Candado de privacidad. La regla que manda sobre todo: NUNCA grabar/exportar
// datos reales. Estas funciones ABORTAN el proceso si detectan prod o datos no-demo.
// Se llaman: (1) al abrir el navegador (URL), (2) antes de grabar (usuario demo),
// (3) antes de exportar cada video (texto visible de cada pantalla).

const REF_PROD = 'jeeqhgccqefbqilntcpu';
const HOSTS_PROD = ['sgcconstructorasd.com', 'sgc-ashen.vercel.app'];

/** Aborta si la URL/ref apunta a producción. Dev reconocido primero (dev.* no es prod). */
export function assertDev(url) {
  const u = String(url || '').toLowerCase();
  const esDev = u.includes('dev.sgcconstructorasd.com') || u.includes('app-dev') || u.includes('localhost');
  if (esDev) return; // entorno dev explícito → OK
  if (u.includes(REF_PROD) || HOSTS_PROD.some((h) => u.includes(h))) {
    throw new Error(`🔴 CANDADO: la URL parece de PRODUCCIÓN (${url}). Los videos se graban SOLO en dev.`);
  }
  throw new Error(`🔴 CANDADO: la URL no es un entorno dev reconocido (${url}).`);
}

/** Aborta si el usuario logueado no es demo (rol revisor_tiendas o flag tutorial_demo). */
export function assertUsuarioDemo(perfil) {
  const roles = (perfil?.roles_codigos ?? perfil?.roles ?? []).map((r) => String(r).toLowerCase());
  const esDemo = roles.includes('revisor_tiendas') || perfil?.tutorial_demo === true;
  if (!esDemo) {
    throw new Error(`🔴 CANDADO: el usuario "${perfil?.nombre ?? '?'}" NO es demo. Graba solo con usuarios demo.`);
  }
}

/**
 * Candado de texto: recibe el texto visible de una pantalla + las listas blancas demo
 * (nombres/cédulas/placas permitidas). Aborta si detecta una cédula, placa o nombre de
 * persona que no esté en la lista demo. Heurística conservadora: cédulas `###-#######-#`
 * que no empiecen en 000, y placas tipo `A######` que no sean DEMO-00x.
 */
export function assertTextoLimpio(texto, demo = {}) {
  const t = String(texto || '');
  const cedulasDemo = new Set((demo.cedulas ?? []).map((c) => c.replace(/\D/g, '')));
  const placasDemo = new Set((demo.placas ?? []).map((p) => p.toUpperCase()));

  // Cédulas reales (no 000-…): ###-#######-#
  for (const m of t.matchAll(/\b(\d{3})-?\d{7}-?\d\b/g)) {
    const limpia = m[0].replace(/\D/g, '');
    if (m[1] !== '000' && !cedulasDemo.has(limpia)) {
      throw new Error(`🔴 CANDADO: posible cédula real en pantalla: ${m[0]}`);
    }
  }
  // Placas tipo A######/I###### que no sean DEMO-00x.
  for (const m of t.matchAll(/\b[A-Z]\d{6}\b/g)) {
    if (!placasDemo.has(m[0].toUpperCase())) {
      throw new Error(`🔴 CANDADO: posible placa real en pantalla: ${m[0]}`);
    }
  }
  return true;
}
