// G1 — guardián determinista. Orquesta todos los chequeos sobre la lista de cambios.
// build/tests los corre el workflow y se pasan aquí como resultado ({ build, tests }: true|false|null).
import { revisarZonaProtegida } from './zona-protegida.mjs';
import { escanearSecretos } from './secretos.mjs';
import { revisarSql } from './sql-linter.mjs';
import { detectarServiceRoleEnCliente } from './service-role-cliente.mjs';
import { revisarTamano } from './tamano-diff.mjs';
import { clasificarZonaRoja } from './zona-roja.mjs';

/**
 * @returns {{ veredicto: 'aprobado'|'rechazado'|'propuesta', motivos: object[], zonaRoja: {esZonaRoja:boolean, categorias:object[]}, medida: object, limites: object }}
 *  - rechazado: viola una regla dura (zona protegida, secreto, SQL destructivo, service role en cliente, build/tests rojos)
 *  - propuesta: solo excede el tamaño (no se escribe código; plan para humano)
 *  - zonaRoja NO rechaza: aprueba técnicamente pero obliga a pedir OK humano (lo decide el workflow).
 */
export function evaluarG1(cambios, { limites = {}, build = null, tests = null, zonaRojaConfig } = {}) {
  const motivos = [];
  motivos.push(...revisarZonaProtegida(cambios));
  motivos.push(...escanearSecretos(cambios));
  motivos.push(...revisarSql(cambios).motivos);
  motivos.push(...detectarServiceRoleEnCliente(cambios));
  if (build === false) motivos.push({ codigo: 'build_rojo', detalle: 'El build falla.' });
  if (tests === false) motivos.push({ codigo: 'tests_rojos', detalle: 'Los tests fallan.' });
  if (cambios.length === 0) motivos.push({ codigo: 'diff_vacio', detalle: 'El PR no cambia nada.' });
  const tam = revisarTamano(cambios, limites);
  const zonaRoja = clasificarZonaRoja(cambios, zonaRojaConfig);
  let veredicto = 'aprobado';
  if (motivos.length) veredicto = 'rechazado';
  else if (tam.motivos.length) veredicto = 'propuesta';
  return { veredicto, motivos: [...motivos, ...tam.motivos], zonaRoja, medida: tam.medida, limites: tam.limites };
}
