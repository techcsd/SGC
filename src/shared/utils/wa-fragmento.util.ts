/**
 * DB-S6 — convierte el `fragmento` que devuelve `sgc.wa_mensajes_grupo_buscar`
 * (ts_headline con `StartSel=**,StopSel=**`) en HTML seguro, resaltando con
 * `<mark>` en vez de mostrar los asteriscos crudos. Escapa todo lo demás: el
 * texto viene de mensajes de WhatsApp de terceros, nunca se confía en él.
 */
export function resaltarFragmentoHtml(fragmento: string): string {
  const partes = (fragmento ?? '').split('**');
  return partes.map((parte, i) => (i % 2 === 1 ? `<mark>${escapeHtmlBasico(parte)}</mark>` : escapeHtmlBasico(parte))).join('');
}

function escapeHtmlBasico(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
