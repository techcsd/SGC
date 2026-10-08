// scripts/data-fixes/2026-10-08-cj6-aplicar-recepciones.mjs — CJ6 (regla 18/19)
// Repara las salidas que YA se recibieron por conduce externo pero quedaron en
// "Despachado": estado → Entregado + entrada al almacén de la obra (helper idempotente
// sgc._aplicar_recepcion_salida). NO toca salidas duplicadas: esas solo se REPORTAN.
//
//   node scripts/data-fixes/2026-10-08-cj6-aplicar-recepciones.mjs --env dev            (DRY-RUN por defecto)
//   node scripts/data-fixes/2026-10-08-cj6-aplicar-recepciones.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-cj6-aplicar-recepciones.mjs --env prod --apply --yes  (solo tras OK)
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

// Candidatas: recibidas (por conduce externo: recibido_por lleno) pero aún 'despachado'.
const SQL_CANDIDATAS = `
  select s.id, s.estado, s.recibido_por, s.proyecto_id,
         (select count(*) from sgc.conduces_externos ce where ce.salida_id = s.id and ce.estado='recibido') as ce_recibidos,
         (select count(*) from sgc.detalle_salidas d where d.salida_id = s.id) as lineas
  from sgc.salidas_inventario s
  where s.estado = 'despachado'
    and s.recibido_por is not null
    and coalesce(s.anulado_por is null, true)
  order by s.created_at`;

// Duplicadas (solo reporte): mismo material+requisición en 2+ salidas no anuladas.
const SQL_DUPLICADAS = `
  with lineas as (
    select s.origen_requisicion_id req, ds.articulo_id, ds.salida_id,
           sum(ds.cantidad) cant
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario s on s.id = ds.salida_id
    where s.origen_requisicion_id is not null and coalesce(s.anulado_por is null, true)
    group by s.origen_requisicion_id, ds.articulo_id, ds.salida_id
  )
  select req, articulo_id, count(distinct salida_id) salidas, sum(cant) total
  from lineas group by req, articulo_id having count(distinct salida_id) > 1
  order by salidas desc limit 50`;

async function main() {
  console.log(`\n▶ CJ6 aplicar recepciones — ${env.entorno} (${env.ref}) — ${APPLY ? 'APLICAR' : 'DRY-RUN'}\n`);

  const cand = await dbq(SQL_CANDIDATAS);
  console.log(`  Candidatas (despachado + recibido_por lleno): ${cand.length}`);
  for (const r of cand.slice(0, 40)) {
    console.log(`    · salida ${r.id} — ${r.lineas} línea(s), ce_recibidos=${r.ce_recibidos}, proyecto=${r.proyecto_id ?? '—'}`);
  }
  if (cand.length > 40) console.log(`    … y ${cand.length - 40} más`);

  const dups = await dbq(SQL_DUPLICADAS);
  console.log(`\n  ⚠️ Posibles salidas DUPLICADAS (mismo material+requisición en 2+ salidas) — NO se tocan, solo reporte: ${dups.length}`);
  for (const d of dups) {
    console.log(`    · req ${d.req} · art ${d.articulo_id} · ${d.salidas} salidas · total ${d.total}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY-RUN: no se aplicó nada. Revisa la lista; con --apply se corre el helper por cada candidata.\n`);
    return;
  }

  let ok = 0, err = 0;
  for (const r of cand) {
    try {
      // El helper es idempotente: si ya está entregada, no duplica.
      await dbq(`select sgc._aplicar_recepcion_salida('${r.id}'::uuid)`);
      ok++;
    } catch (e) {
      err++;
      console.log(`    🔴 ${r.id}: ${String(e.message).slice(0, 120)}`);
    }
  }
  console.log(`\n  ✓ Aplicadas: ${ok} · errores: ${err}. Duplicadas (${dups.length}) quedan para revisión manual de Xaviel/Raykler.\n`);
}

main().catch((e) => { console.error(`\n🔴 ${e.message}\n`); process.exit(1); });
