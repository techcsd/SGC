// scripts/data-fixes/2026-10-14-co3-co5-duplicados.mjs — PROMPT-98 FASE 1 (CO3/CO5)
// Limpieza de los duplicados por doble-toque confirmados en F0 (regla 18/19/CD10).
//
//   node scripts/data-fixes/2026-10-14-co3-co5-duplicados.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-14-co3-co5-duplicados.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-14-co3-co5-duplicados.mjs --env prod --apply --yes   (solo con OK de Xaviel)
//
// CO3 — 5 echadas idénticas de MANOLO DURAN (vehículo L542136) creadas en 20ms
// (23:15:33.116–.136, 12-oct). Se queda la primera (939a7f23…, calculó bien el
// Δkm=227 contra la echada anterior); las otras 4 se invalidan con el mecanismo
// YA existente `resolver_duplicado_echada` (CD8) — no se borran filas.
//
// CO5 — 3 conduces CND-4039EDE0 / CND-EAFE9FCE / CND-0CA71D59 (Misael Encarnación,
// Villa Caleton #260 → sin almacén destino) creados en 5s, con el MISMO contenido
// exacto (64 ANGULAR 20CM + 16 PANEL FILLER + 1800 WEDGE BOLT) — confirma la
// causa (triple-toque, F0). Los 3 llegaron a `entregado_incompleto` con recepción
// confirmada, así que `anular_conduce` (que solo admite pendientes) no sirve aquí:
// este script hace el equivalente — repone el stock de origen que debitaron de
// más y los marca `anulado` con motivo — para los 2 "extra", dejando el PRIMERO
// creado (CND-4039EDE0) como el real.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

// Admin que ejecuta la operación (auditoría / quien decide). Xaviel en ambos entornos.
const [admin] = await dbQuery(env, `
  select u.id from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo = 'admin' and u.nombre ilike 'Xaviel%'
  order by u.created_at asc limit 1`);
if (!admin?.id) { console.error('🔴 No se encontró un admin "Xaviel" en este entorno — abortado.'); process.exit(1); }

function comoAdmin(sql) {
  return `select set_config('request.jwt.claims', json_build_object('sub','${admin.id}','role','authenticated')::text, true);
          select set_config('role','authenticated', true);
          ${sql}`;
}

console.log(`\n=== CO3 — echadas duplicadas (L542136, Manolo Durán, 12-oct 23:15:33) ===`);
const echadas = await dbQuery(env, `
  select rc.id, rc.client_uuid, rc.created_at::text, rc.estado, rc.km_recorridos, coalesce(rc.invalidada,false) as invalidada
  from sgc.registros_combustible rc
  join sgc.vehiculos v on v.id = rc.vehiculo_id
  where v.placa ilike '%542136%'
    and rc.created_at between '2026-10-12 23:15:33+00' and '2026-10-12 23:15:34+00'
  order by rc.created_at asc`);
if (echadas.length < 2) {
  console.log('(sin filas en este entorno — probablemente dev, que no tiene el seed de prod)');
} else {
  const [keep, ...extras] = echadas;
  console.log(`  queda: ${keep.id} (${keep.created_at}, ${keep.estado}, Δkm=${keep.km_recorridos})`);
  for (const ex of extras) {
    console.log(`  ${APPLY ? 'invalidando' : '(dry-run) invalidaría'}: ${ex.id} (${ex.created_at}, ${ex.estado}, ya invalidada=${ex.invalidada})`);
    if (APPLY && !ex.invalidada) {
      await dbQuery(env, comoAdmin(
        `select sgc.resolver_duplicado_echada('${keep.id}'::uuid, '${ex.id}'::uuid, 'misma', '${ex.id}'::uuid);`));
    }
  }
}

console.log(`\n=== CO5 — conduces duplicados (CND-4039EDE0 / CND-EAFE9FCE / CND-0CA71D59) ===`);
const conduces = await dbQuery(env, `
  select si.id, upper(left(si.id::text,8)) as codigo, si.created_at::text, si.estado, si.bodega_id,
         coalesce((si.estado='anulado'),false) as ya_anulado,
         (select jsonb_agg(jsonb_build_object('articulo_id', d.articulo_id, 'cantidad', d.cantidad))
            from sgc.detalle_salidas d where d.salida_id = si.id) as items
  from sgc.salidas_inventario si
  where upper(left(si.id::text,8)) in ('0CA71D59','EAFE9FCE','4039EDE0')
  order by si.created_at asc`);
if (conduces.length < 2) {
  console.log('(sin filas en este entorno — probablemente dev)');
} else {
  const [keep, ...extras] = conduces;
  const mismoContenido = extras.every((e) => JSON.stringify(e.items) === JSON.stringify(keep.items));
  console.log(`  queda: CND-${keep.codigo} (${keep.created_at}, ${keep.estado})`);
  console.log(`  contenido idéntico en los 3: ${mismoContenido ? 'SÍ (confirma triple-toque)' : 'NO — revisar a mano antes de aplicar'}`);
  for (const ex of extras) {
    console.log(`  ${APPLY ? 'anulando + reponiendo stock' : '(dry-run) anularía + repondría stock'}: CND-${ex.codigo} (${ex.created_at}, ${ex.estado}, ya anulado=${ex.ya_anulado})`);
    for (const it of ex.items ?? []) console.log(`      + repone ${it.cantidad} de ${it.articulo_id} en bodega ${ex.bodega_id}`);
    if (APPLY && !ex.ya_anulado) {
      if (!mismoContenido) { console.log('      ⚠️ SALTADO — el contenido no coincide exactamente, revisar a mano.'); continue; }
      await dbQuery(env, comoAdmin(`
        do $$
        declare r record;
        begin
          for r in select articulo_id, cantidad from sgc.detalle_salidas where salida_id = '${ex.id}'::uuid loop
            perform sgc.adjust_stock(r.articulo_id, '${ex.bodega_id}'::uuid, r.cantidad);
          end loop;
          update sgc.salidas_inventario
             set estado = 'anulado', anulado_por = '${admin.id}'::uuid, anulado_en = now(),
                 motivo_anulacion = 'CO15/CO5 — duplicado por triple-toque al crear (PROMPT-98 F1); se queda CND-${keep.codigo}'
           where id = '${ex.id}'::uuid;
        end $$;`));
    }
  }
}

console.log(APPLY ? '\n✅ aplicado.' : '\n(dry-run) usa --apply para ejecutar. Prod requiere OK explícito de Xaviel.');
