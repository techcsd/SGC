// BH4 — nadie debe ver un email sintético (cap-…@personal.constructorasd.local,
// c-…@conductores.constructorasd.local, t-…@test.constructorasd.local). Donde se
// mostraría el correo, se enseña la cédula (o "usuario de prueba") en su lugar.

const DOMINIO_CEDULA = /@(personal|conductores)\.constructorasd\.local$/i;
const DOMINIO_PRUEBA = /@test\.constructorasd\.local$/i;

/** ¿Es un correo sintético (no un buzón real)? */
export function esEmailSintetico(email?: string | null): boolean {
  return !!email && (DOMINIO_CEDULA.test(email) || DOMINIO_PRUEBA.test(email));
}

/**
 * Etiqueta de identidad para mostrar: el correo real si lo hay; si es sintético,
 * la cédula (Cédula 00112345678) o "Usuario de prueba"; si no hay nada, un guion.
 */
export function identidadLabel(u: { email?: string | null; cedula?: string | null }): string {
  const email = u.email ?? null;
  if (email && !esEmailSintetico(email)) return email;
  if (u.cedula) return `Cédula ${u.cedula}`;
  if (DOMINIO_PRUEBA.test(email ?? '')) return 'Usuario de prueba';
  // Sin cédula guardada: derivar de la parte local del email sintético.
  if (email && DOMINIO_CEDULA.test(email)) {
    const ced = email.split('@')[0].replace(/^(cap-|c-)/, '');
    return ced ? `Cédula ${ced}` : 'Sin correo';
  }
  return 'Sin correo';
}
