// Procesa la respuesta del Guardián IA (G2) y la combina con G1. Falla CERRADO.
//   node scripts/guardianes/g2.mjs --claude-out out.txt --g1 g1.json [--tarea <uuid>] [--pr N] [--sin-rpc]
// Escribe veredicto.json y comentario.md (con marcador oculto para que el Ingeniero lo lea), registra en la tarea
// (ing_evento_registrar / ing_tarea_actualizar) y, si hay zona roja, crea la aprobación humana.
// Exit: 0 aprobado, 1 rechazado.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { veredictoDesdeTexto } from './lib/veredicto.mjs';
import { llamarRpc, faltantes } from './rpc.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const leer = (f) => (f && existsSync(f) ? readFileSync(f, 'utf8') : '');

export function combinar(g1, g2) {
  const motivos = [];
  let veredicto = g2.veredicto;
  if (g1.veredicto !== 'aprobado') { veredicto = 'rechazado'; motivos.push(...g1.motivos.map((m) => `[G1] ${m.detalle}`)); }
  motivos.push(...g2.motivos.map((m) => `[G2] ${m}`));
  const zona = g1.zonaRoja?.esZonaRoja === true;
  return { veredicto, riesgo: zona && g2.riesgo === 'bajo' ? 'medio' : g2.riesgo, motivos, zonaRoja: zona, categoriasZonaRoja: (g1.zonaRoja?.categorias ?? []).map((c) => c.etiqueta) };
}

export function comentario(v, pr, sha) {
  const marcador = `<!-- guardian-veredicto: ${JSON.stringify({ sha: sha ?? null, veredicto: v.veredicto, riesgo: v.riesgo, motivos: v.motivos, zonaRoja: v.zonaRoja }).replaceAll('>', String.fromCharCode(92) + 'u003e')} -->`;
  const icono = v.veredicto === 'aprobado' ? 'APROBADO' : 'RECHAZADO';
  return `${marcador}\n### Guardián — ${icono} (riesgo ${v.riesgo})\n\n${v.motivos.length ? v.motivos.map((m) => `- ${m}`).join('\n') : '- Sin observaciones.'}\n\n${v.zonaRoja ? `**Zona roja** (${v.categoriasZonaRoja.join(', ')}): se detiene en dev y requiere OK humano en Tecnología › Agentes.\n` : ''}\n_PR #${pr ?? '?'} — el Guardián no puede aprobarse a sí mismo ni empujar código._\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const g1 = JSON.parse(leer(arg('g1')) || '{"veredicto":"rechazado","motivos":[{"detalle":"G1 no produjo resultado"}],"zonaRoja":{}}');
  const g2 = veredictoDesdeTexto(leer(arg('claude-out')));
  const v = combinar(g1, g2);
  writeFileSync('veredicto.json', JSON.stringify(v, null, 2));
  writeFileSync('comentario.md', comentario(v, arg("pr"), arg("sha")));
  console.log(`veredicto=${v.veredicto} riesgo=${v.riesgo} zona_roja=${v.zonaRoja}`);
  const tarea = arg('tarea');
  if (tarea && !process.argv.includes('--sin-rpc') && faltantes().length === 0) {
    try {
      await llamarRpc('ing_evento_registrar', { p_tarea: tarea, p_tipo: 'guardian_veredicto', p_detalle: v, p_costo_usd: Number(arg('costo', 0)) });
      if (v.zonaRoja && v.veredicto === 'aprobado') {
        const id = await llamarRpc('ing_zona_roja_crear_aprobacion', { p_tarea: tarea, p_motivo: `Zona roja: ${v.categoriasZonaRoja.join(', ')}` });
        console.log(`aprobacion_zona_roja=${typeof id === 'string' ? id : JSON.stringify(id)}`);
        await llamarRpc('ing_tarea_actualizar', { p_id: tarea, p_estado: 'en_revision', p_patch: { guardian: v, zona_roja: true, requiere_ok_humano: true } });
      } else {
        await llamarRpc('ing_tarea_actualizar', { p_id: tarea, p_estado: v.veredicto === 'aprobado' ? 'en_revision' : 'en_codigo', p_patch: { guardian: v } });
      }
    } catch (e) { console.error(`no se pudo guardar en la tarea: ${e.message}`); }
  }
  process.exit(v.veredicto === 'aprobado' ? 0 : 1);
}
