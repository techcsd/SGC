// smoke-requisicion-estados.mjs — BG5 (PROMPT-28 FASE 2).
//
// Regla 3 del checklist de migraciones: "estado nuevo ⇒ constraint actualizado +
// smoke de CADA transición". Este smoke prueba, contra prod y con ROLLBACK, que el
// `solicitudes_material_estado_check` acepta TODOS los estados vigentes que el
// código escribe (BA6: por_despachar/parcial/completada/cancelada + originales).
// Falla !=0 si algún estado es rechazado por el constraint.
//
// Uso:  node scripts/smoke-requisicion-estados.mjs
// Necesita SUPABASE_ACCESS_TOKEN. On-demand.
const PROJECT_REF = 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Estados vigentes que el código puede escribir (solicitud.model.ts + BA6 RPCs).
const ESTADOS = ['pendiente','aprobada','por_despachar','parcial','completada','entregada','cerrada','rechazada','cancelada'];

const target = await q(`select id from sgc.solicitudes_material order by folio desc nulls last limit 1;`);
if (!target?.[0]?.id) { console.error('No hay requisiciones para el smoke'); process.exit(1); }
const id = target[0].id;

let fallos = 0;
for (const s of ESTADOS) {
  try {
    await q(`
      begin;
      update sgc.solicitudes_material set estado = '${s}' where id = '${id}'::uuid;
      rollback;
    `);
    console.log(`✓ estado '${s}' aceptado`);
  } catch (e) {
    console.error(`✗ estado '${s}' RECHAZADO — ${e.message}`);
    fallos++;
  }
}
if (fallos) { console.error(`\n🔴 ${fallos} estado(s) rechazado(s) por el constraint — actualízalo.`); process.exit(1); }
console.log('\n✓ Constraint de estado de requisición al día — todas las transiciones aceptadas.');
