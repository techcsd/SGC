// smoke-combustible-prod.mjs — BR1 (PROMPT-52 F1).
//
// Regla 15: el servidor ACEPTA lo que el chofer echó, lo MARCA y AVISA; el rechazo
// duro queda solo para lo imposible. Este smoke prueba, contra prod y con ROLLBACK,
// que registrar_combustible_app:
//   #1  acepta un salto de km con bandera km_alerta (antes rechazaba al chofer)
//       y mide el salto desde el km base fijado por admin (vehiculo_set_km_base_combustible)
//   #2  acepta una echada de un chofer NO asignado con bandera sin_asignacion (AF18/Felix)
//   #3  sigue rechazando (22023) galones/precio imposibles para el chofer
//
// La sesión se simula con request.jwt.claims dentro de la transacción (auth.uid()).
// Uso:  node scripts/smoke-combustible-prod.mjs   (necesita SUPABASE_ACCESS_TOKEN)
const REF = 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) });
  const t = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${t}`);
  return t;
}

// QA fijos (no es_prueba). Vehículos reales con medida km.
const CHOFER = '504af5da-0939-495e-a39b-6b722e22bfd1'; // QA chofer_transportista (no elevado)
const ADMIN  = '04a1547b-8e10-447d-89be-6248019c254b'; // QA admin

const sql = `
begin;
do $$
declare
  v_res jsonb; v_odo int;
  v_veh_km uuid; v_veh_sa uuid;
  v_chofer uuid := '${CHOFER}'; v_admin uuid := '${ADMIN}';
begin
  -- vehículo sin responsable (para km_alerta puro) y uno con responsable != chofer (sin_asignacion)
  select id into v_veh_km from sgc.vehiculos where coalesce(activo,true) and not coalesce(es_prueba,false)
    and coalesce(medida_uso,'km')='km' and responsable_id is null limit 1;
  select id into v_veh_sa from sgc.vehiculos where coalesce(activo,true) and not coalesce(es_prueba,false)
    and coalesce(medida_uso,'km')='km' and responsable_id is not null and responsable_id <> v_chofer limit 1;

  select kilometraje into v_odo from sgc.vehiculos where id=v_veh_km;
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);
  perform sgc.vehiculo_set_km_base_combustible(v_veh_km, v_odo - 500, 'smoke BR1');

  perform set_config('request.jwt.claims', json_build_object('sub',v_chofer,'role','authenticated')::text, true);
  v_res := sgc.registrar_combustible_app(gen_random_uuid(), v_veh_km, null, current_date, v_odo + 2000, 10, 3000, p_foto_tablero_path => 'smoke/tab.jpg');
  if (v_res->>'km_alerta')::boolean is not true then raise exception 'FAIL #1 km_alerta=%', v_res; end if;
  if (v_res->>'km_anterior')::int <> v_odo - 500 then raise exception 'FAIL #1 km_base no honrado=%', v_res; end if;

  select kilometraje into v_odo from sgc.vehiculos where id=v_veh_sa;
  v_res := sgc.registrar_combustible_app(gen_random_uuid(), v_veh_sa, null, current_date, v_odo + 30, 10, 3000, p_foto_tablero_path => 'smoke/tab.jpg');
  if (v_res->>'sin_asignacion')::boolean is not true then raise exception 'FAIL #2 sin_asignacion=%', v_res; end if;

  begin
    v_res := sgc.registrar_combustible_app(gen_random_uuid(), v_veh_sa, null, current_date, v_odo + 60, 99999, 300000, p_foto_tablero_path => 'smoke/tab.jpg');
    raise exception 'FAIL #3 galones imposibles NO rechazado';
  exception when sqlstate '22023' then null; end;
end $$;
rollback;`;

try { await q(sql); console.log('✓ SMOKE BR1 OK — 3/3 (km_alerta+km_base, sin_asignacion, rechazo duro 22023) — rolled back'); }
catch (e) { console.error('✗ SMOKE BR1 FALLÓ:', e.message.slice(0, 600)); process.exit(1); }
