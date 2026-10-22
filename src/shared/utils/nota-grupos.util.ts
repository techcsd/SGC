// CV2/CV3 — Dev notes: validaciones puras de grupos (carpetas anidadas). El
// trigger de BD (`sgc.tg_nota_grupos_validar`) sigue siendo la autoridad; esto
// solo anticipa el mismo resultado en el cliente para dar feedback inmediato
// (sin ida y vuelta al servidor) al crear/renombrar/arrastrar.

export interface NotaGrupoLike {
  id: string;
  parent_id: string | null;
  nombre: string;
}

const MAX_NIVELES = 4;

/** CV2.2 — nombre recortado, 1-60 caracteres, sin repetir entre hermanos (sin
 *  distinguir mayúsculas). Devuelve el mensaje de error o null si es válido.
 *  Un nombre vacío no es un "error" visible (el botón Crear solo se apaga). */
export function validarNombreGrupo(nombre: string, nombresHermanos: string[]): string | null {
  const limpio = nombre.trim();
  if (!limpio) return null;
  if (limpio.length > 60) return 'El nombre no puede pasar de 60 caracteres.';
  const bajo = limpio.toLowerCase();
  if (nombresHermanos.some((h) => h.trim().toLowerCase() === bajo)) {
    return 'Ya tienes un grupo con ese nombre aquí.';
  }
  return null;
}

/** Profundidad de un grupo (1 = raíz). null = raíz (profundidad 0, para "crear aquí"). */
export function profundidadDeGrupo(grupoId: string | null, grupos: NotaGrupoLike[]): number {
  const porId = new Map(grupos.map((g) => [g.id, g]));
  let profundidad = 0;
  let cursor = grupoId;
  let guard = 0;
  while (cursor && guard < 20) {
    profundidad++;
    cursor = porId.get(cursor)?.parent_id ?? null;
    guard++;
  }
  return profundidad;
}

/** Altura del subárbol de un grupo (0 = sin hijos). */
function alturaSubarbol(grupoId: string, porPadre: Map<string | null, NotaGrupoLike[]>): number {
  const hijos = porPadre.get(grupoId) ?? [];
  if (!hijos.length) return 0;
  return 1 + Math.max(...hijos.map((h) => alturaSubarbol(h.id, porPadre)));
}

/** CV3.4 — ¿se puede mover `grupoId` a ser hijo de `destinoId` (null = raíz)?
 *  No a sí mismo, no a un descendiente suyo, y la profundidad final (contando
 *  todo el subárbol que se mueve) no puede pasar de 4 niveles. */
export function puedeMoverGrupo(grupoId: string, destinoId: string | null, grupos: NotaGrupoLike[]): boolean {
  if (destinoId === grupoId) return false;
  const porId = new Map(grupos.map((g) => [g.id, g]));

  // El destino no puede ser el propio grupo ni un descendiente suyo.
  let cursor = destinoId;
  let guard = 0;
  while (cursor && guard < 20) {
    if (cursor === grupoId) return false;
    cursor = porId.get(cursor)?.parent_id ?? null;
    guard++;
  }

  const porPadre = new Map<string | null, NotaGrupoLike[]>();
  for (const g of grupos) {
    const arr = porPadre.get(g.parent_id);
    if (arr) arr.push(g);
    else porPadre.set(g.parent_id, [g]);
  }
  const profundidadDestino = destinoId ? profundidadDeGrupo(destinoId, grupos) : 0;
  const alturaMovido = alturaSubarbol(grupoId, porPadre);
  return profundidadDestino + 1 + alturaMovido <= MAX_NIVELES;
}

/** CV2.2 — "+" (nuevo subgrupo) se apaga en el nivel 4: un hijo de este grupo
 *  quedaría en el nivel 5. */
export function puedeCrearSubgrupo(parentId: string, grupos: NotaGrupoLike[]): boolean {
  return profundidadDeGrupo(parentId, grupos) < MAX_NIVELES;
}
