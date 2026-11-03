// DH17 — render de solo-lectura para markdown generado por el servidor (informes
// de agentes): encabezados, negrita, listas y párrafos. Nada de HTML arbitrario
// del origen — se escapa primero y solo entonces se aplican los patrones.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderMarkdownSimple(md: string): string {
  const lineas = escapeHtml(md ?? '').split('\n');
  const html: string[] = [];
  let enLista = false;

  const cerrarLista = () => {
    if (enLista) { html.push('</ul>'); enLista = false; }
  };
  const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  for (const linea of lineas) {
    const l = linea.trim();
    if (!l) { cerrarLista(); continue; }
    if (l.startsWith('## ')) { cerrarLista(); html.push(`<h3>${inline(l.slice(3))}</h3>`); continue; }
    if (l.startsWith('# ')) { cerrarLista(); html.push(`<h2>${inline(l.slice(2))}</h2>`); continue; }
    if (l.startsWith('- ')) {
      if (!enLista) { html.push('<ul>'); enLista = true; }
      html.push(`<li>${inline(l.slice(2))}</li>`);
      continue;
    }
    cerrarLista();
    html.push(`<p>${inline(l)}</p>`);
  }
  cerrarLista();
  return html.join('');
}
