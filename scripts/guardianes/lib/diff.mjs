// Parser de `git diff` (unified) a la lista de cambios que consume G1.
// cambio = { ruta, rutaAnterior?, estado: 'A'|'M'|'D'|'R', agregadas, borradas, lineasAgregadas: string[] }
export function parsearDiff(texto) {
  const cambios = [];
  let cur = null;
  let enHunk = false;
  for (const linea of String(texto).split('\n')) {
    if (linea.startsWith('diff --git ')) {
      const m = linea.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { ruta: m ? m[2] : linea.slice(11), estado: 'M', agregadas: 0, borradas: 0, lineasAgregadas: [] };
      cambios.push(cur);
      enHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!enHunk) {
      if (linea.startsWith('new file mode')) cur.estado = 'A';
      else if (linea.startsWith('deleted file mode')) cur.estado = 'D';
      else if (linea.startsWith('rename from ')) { cur.estado = 'R'; cur.rutaAnterior = linea.slice(12); }
      else if (linea.startsWith('rename to ')) cur.ruta = linea.slice(10);
      else if (linea.startsWith('@@')) enHunk = true;
      continue;
    }
    if (linea.startsWith('@@')) continue;
    if (linea.startsWith('+')) { cur.agregadas++; cur.lineasAgregadas.push(linea.slice(1)); }
    else if (linea.startsWith('-')) cur.borradas++;
  }
  return cambios;
}
