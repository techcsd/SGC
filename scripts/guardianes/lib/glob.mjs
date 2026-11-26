// Glob mínimo (** y *) -> RegExp. Sin dependencias.
export function globARegex(glob) {
  let r = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; r += '(?:.*/)?'; } else r += '.*';
      } else r += '[^/]*';
    } else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}
export const normalizarRuta = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
export function coincideAlguno(ruta, globs) {
  const p = normalizarRuta(ruta);
  return globs.some((g) => globARegex(g).test(p));
}
