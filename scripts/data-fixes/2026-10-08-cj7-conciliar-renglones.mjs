// scripts/data-fixes/2026-10-08-cj7-conciliar-renglones.mjs — CJ7 (regla 18/19)
// Repara los renglones LIBRE que nunca contaron como despachados: asigna
// articulo_despacho_id al renglón y origen_item_id a la línea del despacho, SOLO cuando
// no hay ambigüedad (un único match por cantidad). Lo ambiguo NO se toca: sale en el
// reporte para conciliarlo a mano en la ventana de la requisición.
//
//   node scripts/data-fixes/2026-10-08-cj7-conciliar-renglones.mjs --env dev           (DRY-RUN)
//   node scripts/data-fixes/2026-10-08-cj7-conciliar-renglones.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-cj7-conciliar-renglones.mjs --env prod --apply --yes  (solo tras OK)
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

async function dbq(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return []; }
}

// Renglones LIBRE sin artículo de despacho, de requisiciones con despacho enlazado.
// Para cada uno: ¿hay EXACTAMENTE UNA línea de despacho (sin origen_item_id) de esa
// requisición con la misma cantidad? → match seguro. 2+ o 0 → ambiguo (no se toca).
const SQL_MATCHES = `
  with libres as (
    select smi.id item_id, smi.solicitud_id req, smi.cantidad, smi.descripcion
    from sgc.solicitud_material_items smi
    where smi.articulo_id is null and smi.articulo_despacho_id is null
      and coalesce(smi.estado,'pendiente') <> 'cancelada'
      and exists (select 1 from sgc.salidas_inventario s
                  where s.origen_requisicion_id = smi.solicitud_id and coalesce(s.anulado_por is null,true))
  ),
  lineas as (
    select ds.id linea_id, ds.articulo_id, ds.cantidad, s.origen_requisicion_id req
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where ds.origen_item_id is null and s.origen_requisicion_id is not null
      and coalesce(s.anulado_por is null, true)
  ),
  candidatos as (
    select l.item_id, l.req, l.cantidad, l.descripcion,
           (select count(*) from lineas ln where ln.req = l.req and ln.cantidad = l.cantidad) n_match,
           (select ln.linea_id from lineas ln where ln.req = l.req and ln.cantidad = l.cantidad limit 1) linea_id,
           (select ln.articulo_id from lineas ln where ln.req = l.req and ln.cantidad = l.cantidad limit 1) articulo_id
    from libres l
  )
  select * from candidatos order by req`;

async function main() {
  console.log(`\n▶ CJ7 conciliar renglones LIBRE — ${env.entorno} (${env.ref}) — ${APPLY ? 'APLICAR' : 'DRY-RUN'}\n`);

  const rows = await dbq(SQL_MATCHES);
  const seguros = rows.filter((r) => Number(r.n_match) === 1 && r.articulo_id);
  const ambiguos = rows.filter((r) => Number(r.n_match) !== 1 || !r.articulo_id);

  console.log(`  Renglones LIBRE sin despacho asignado: ${rows.length}`);
  console.log(`  ✓ Match seguro (una sola línea con esa cantidad): ${seguros.length}`);
  for (const r of seguros.slice(0, 40)) {
    console.log(`    · item ${r.item_id} (req ${r.req}, cant ${r.cantidad}) → línea ${r.linea_id} art ${r.articulo_id}  «${(r.descripcion||'').slice(0,40)}»`);
  }
  console.log(`  ⚠️ Ambiguo (0 o 2+ líneas con esa cantidad) — NO se toca, conciliar a mano: ${ambiguos.length}`);
  for (const r of ambiguos.slice(0, 30)) {
    console.log(`    · item ${r.item_id} (req ${r.req}, cant ${r.cantidad}, matches=${r.n_match})  «${(r.descripcion||'').slice(0,40)}»`);
  }

  if (!APPLY) {
    console.log(`\n  DRY-RUN: no se aplicó nada. Con --apply se asignan SOLO los ${seguros.length} seguros.\n`);
    return;
  }

  let ok = 0, err = 0;
  for (const r of seguros) {
    try {
      await dbq(`update sgc.solicitud_material_items set articulo_despacho_id='${r.articulo_id}'::uuid where id='${r.item_id}'::uuid and articulo_despacho_id is null;
                 update sgc.detalle_salidas set origen_item_id='${r.item_id}'::uuid where id='${r.linea_id}'::uuid and origen_item_id is null;`);
      ok++;
    } catch (e) { err++; console.log(`    🔴 item ${r.item_id}: ${String(e.message).slice(0,120)}`); }
  }
  console.log(`\n  ✓ Conciliados: ${ok} · errores: ${err}. Ambiguos (${ambiguos.length}) quedan para la ventana de la requisición.\n`);
}

main().catch((e) => { console.error(`\n🔴 ${e.message}\n`); process.exit(1); });
