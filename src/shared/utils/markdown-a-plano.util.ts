/**
 * CQ2 — "Mandar a ronda": convierte Markdown a texto plano legible para pegar
 * en una conversación de chat que NO renderiza Markdown (WhatsApp, Slack sin
 * formato, etc.). No busca ser perfecto — solo que no se vea `**negrita**` ni
 * `## título` crudo. Trabaja sobre el STRING markdown (no sobre el doc de
 * TipTap): es independiente del editor y fácil de probar.
 */
export function markdownAPlano(markdown: string): string {
  const lineas = markdown.split('\n');
  const out: string[] = [];
  let enBloqueCodigo = false;

  for (const linea of lineas) {
    // Bloques de código: se dejan tal cual (ya son texto plano legible), solo
    // se quita la línea de la cerca ``` con el lenguaje.
    if (/^\s*```/.test(linea)) {
      enBloqueCodigo = !enBloqueCodigo;
      continue;
    }
    if (enBloqueCodigo) {
      out.push(linea);
      continue;
    }

    let l = linea;

    // Tabla: quita las barras y la fila separadora `| --- | --- |`.
    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue; // fila separadora
      l = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).join(' — ');
      out.push(l);
      continue;
    }

    // Checkboxes (antes de la viñeta genérica, para usar el glifo ☐/☑).
    const checkbox = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(l);
    if (checkbox) {
      const marcado = checkbox[2].toLowerCase() === 'x';
      l = `${checkbox[1]}${marcado ? '☑' : '☐'} ${checkbox[3]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    // Encabezados → el texto tal cual (sin los `#`).
    const heading = /^(\s*)#{1,6}\s+(.*)$/.exec(l);
    if (heading) {
      l = `${heading[1]}${heading[2]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    // Cita: quita el `>` pero conserva el texto.
    const cita = /^(\s*)>\s?(.*)$/.exec(l);
    if (cita) {
      l = `${cita[1]}${cita[2]}`;
      out.push(aplicarEnfasisInline(l));
      continue;
    }

    // Línea horizontal → separador visual simple.
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) {
      out.push('—————');
      continue;
    }

    out.push(aplicarEnfasisInline(l));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Quita negrita/cursiva/tachado/código inline y deja enlaces como "texto (url)".
 *  CS2 — una imagen pegada (`![alt](nota-img:<ruta>)`) nunca sale como ruta
 *  rota interna: se avisa que no viaja con el texto plano. */
function aplicarEnfasisInline(texto: string): string {
  return texto
    .replace(/!\[([^\]]*)\]\(nota-img:[^)]+\)/g, (_m, alt: string) =>
      alt.trim() ? `[imagen no incluida: ${alt.trim()}]` : '[imagen no incluida]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // [texto](url)
    .replace(/~~(.+?)~~/g, '$1') // ~~tachado~~
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1') // ***negrita cursiva***
    .replace(/\*\*(.+?)\*\*/g, '$1') // **negrita**
    .replace(/__(.+?)__/g, '$1') // __negrita__
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1') // *cursiva*
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1') // _cursiva_
    .replace(/`([^`]+)`/g, '$1'); // `código`
}
