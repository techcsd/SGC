// EA8 — vista previa en listas de notas: quita el Markdown de imagen (`![alt](src)` y
// `nota-img:…`) y lo sustituye por «[imagen]»; recorta a `max` caracteres.
export function previewNota(contenido: string | null | undefined, max = 140): string {
  let t = (contenido ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [imagen] ') // ![alt](src)
    .replace(/!\[[^\]]*$/g, ' [imagen] ')          // `![…` cortado por un recorte previo
    .replace(/nota-img:\S+/g, ' [imagen] ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/(\[imagen\] ?){2,}/g, '[imagen] ').trim();
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}
