// smoke-de2-reverso.mjs — Ronda DE F3 (DE2/DE-05/DE-06): reverso como segundo
// documento (emparejado) y reverso huérfano (solo imagen, sin tocar campos).
// Todo dentro de BEGIN/ROLLBACK — nada queda guardado.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

const VEH_ID = '18991562-562b-43eb-b788-6e1274a59568'; // A631739 (dev), vencimiento_seguro 2026-10-28

const sql = `
begin;
do $$
declare
  v_admin uuid; v_res jsonb; v_r jsonb; v_docs int;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- #1 — anverso (seguro) con reverso_imagen_path → 2 documentos insertados.
  v_res := sgc.flota_documentos_aplicar(jsonb_build_array(jsonb_build_object(
    'vehiculo_id', '${VEH_ID}', 'tipo', 'seguro', 'pagina', 1,
    'campos', jsonb_build_object('poliza','SMOKE-DE2-1','aseguradora','SURA','vigencia_hasta','2028-10-28'),
    'imagen_path', 'smoke/de2-anverso.png',
    'reverso_imagen_path', 'smoke/de2-reverso.png'
  )));
  v_r := v_res->0;
  if not (v_r->>'ok')::boolean then raise exception 'FAIL #1: no aplicó — %', v_r->>'error'; end if;

  select count(*) into v_docs from sgc.documentos
    where entidad='vehiculo' and entidad_id='${VEH_ID}'
      and path in ('smoke/de2-anverso.png','smoke/de2-reverso.png');
  if v_docs <> 2 then raise exception 'FAIL #1b: esperaba 2 documentos (anverso+reverso), hay %', v_docs; end if;

  if not exists (select 1 from sgc.documentos where path='smoke/de2-reverso.png' and nombre ilike '%reverso%') then
    raise exception 'FAIL #1c: el documento del reverso no quedó etiquetado "reverso" en el nombre';
  end if;

  if (select vencimiento_seguro from sgc.vehiculos where id='${VEH_ID}') <> '2028-10-28' then
    raise exception 'FAIL #1d: el campo del vehículo no se actualizó con el anverso';
  end if;

  -- #2 — reverso HUÉRFANO (tipo=reverso, sin campos): solo imagen, no toca nada del vehículo.
  v_res := sgc.flota_documentos_aplicar(jsonb_build_array(jsonb_build_object(
    'vehiculo_id', '${VEH_ID}', 'tipo', 'reverso', 'pagina', 2,
    'campos', '{}'::jsonb, 'imagen_path', 'smoke/de2-huerfano.png'
  )));
  v_r := v_res->0;
  if not (v_r->>'ok')::boolean then raise exception 'FAIL #2: no aplicó huérfano — %', v_r->>'error'; end if;
  if v_r->'aplicado' <> '{}'::jsonb then raise exception 'FAIL #2b: reverso huérfano no debe "aplicar" ningún campo — %', v_r->'aplicado'; end if;
  if not exists (select 1 from sgc.documentos where path='smoke/de2-huerfano.png' and tipo='reverso') then
    raise exception 'FAIL #2c: no se guardó el documento del reverso huérfano';
  end if;

  -- #3 — tipo todavía rechazado si no es ninguno de los 4 válidos.
  v_res := sgc.flota_documentos_aplicar(jsonb_build_array(jsonb_build_object(
    'vehiculo_id', '${VEH_ID}', 'tipo', 'licencia', 'pagina', 3, 'campos', '{}'::jsonb
  )));
  v_r := v_res->0;
  if (v_r->>'ok')::boolean then raise exception 'FAIL #3: tipo no soportado no debió aplicar'; end if;

  raise notice 'OK — DE2/F3: anverso+reverso emparejado (2 docs) + reverso huérfano (solo imagen) + tipo inválido rechazado.';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-de2-reverso OK (rollback, nada quedó guardado)');
