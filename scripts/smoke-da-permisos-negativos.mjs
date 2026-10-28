// smoke-da-permisos-negativos.mjs — DA-21 (ronda DA, inventario tecnológico).
// Verifica que un usuario SIN el permiso correcto es RECHAZADO (no solo que el
// usuario correcto es aceptado). Transaccional, ROLLBACK, no persiste nada.
// Mismo patrón que scripts/smoke-cw-permisos-negativos.mjs.
//
//   node scripts/smoke-da-permisos-negativos.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 Este smoke solo corre contra dev.'); process.exit(1); }

const sql = `
begin;
do $$
declare
  v_ingeniero uuid := gen_random_uuid();
  v_subadmin uuid; v_tecnologia uuid; v_admin uuid;
  v_kit_id uuid; v_c1 uuid; v_c2 uuid;
  v_codigo_count int;
begin
  select ur.usuario_id into v_subadmin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'subadmin' limit 1;
  select ur.usuario_id into v_tecnologia from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'tecnologia' limit 1;
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'Falta un usuario QA admin en este entorno'; end if;

  -- Usuario sintético: SOLO el rol ingeniero_oficina (sin tecnologia, sin admin,
  -- sin permiso granular) — garantiza exactamente "nadie le dio nada".
  insert into auth.users (id) values (v_ingeniero);
  insert into sgc.usuarios (id, nombre, email, activo)
  values (v_ingeniero, 'Smoke DA sin-permiso', 'smoke-da-sinpermiso@dev.constructorasd.local', true);
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  select v_ingeniero, r.id, v_admin from sgc.roles r where r.codigo = 'ingeniero_oficina';

  -- #1 — tec_equipo_claves: CERO columnas legibles por 'authenticated' (ni
  -- metadata) — a propósito, más estricto que boveda_entradas.
  if exists (
    select 1 from information_schema.role_column_grants
     where table_schema = 'sgc' and table_name = 'tec_equipo_claves' and grantee = 'authenticated'
  ) then
    raise exception 'FAIL #1: tec_equipo_claves tiene columnas con grant a authenticated (debe ser cero)';
  end if;

  -- #2 — puede_ver_claves_equipos(): false para quien no tiene el permiso
  -- granular (ni siquiera con el módulo tecnologia completo — DA-06 a propósito).
  perform set_config('request.jwt.claims', json_build_object('sub', v_ingeniero, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if sgc.puede_ver_claves_equipos() then
    raise exception 'FAIL #2: ingeniero sin permiso vio puede_ver_claves_equipos()=true';
  end if;

  if v_tecnologia is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_tecnologia, 'role', 'authenticated')::text, true);
    if sgc.puede_ver_claves_equipos() then
      raise exception 'FAIL #2b: un rol con el MODULO tecnologia completo (sin el permiso granular) vio puede_ver_claves_equipos()=true — el atajo de módulo de AG12 se coló aquí (no debería, DA-06)';
    end if;
  end if;

  -- #3 — admin SIEMPRE puede (gate real, camino positivo).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if not sgc.puede_ver_claves_equipos() then
    raise exception 'FAIL #3: admin deberia poder ver claves de equipos';
  end if;

  -- #4 — tec_equipo_historial: no editable ni borrable por authenticated
  -- (solo insertar) — ni por admin, vía el cliente normal.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'sgc' and table_name = 'tec_equipo_historial' and grantee = 'authenticated'
       and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL #4: tec_equipo_historial permite UPDATE/DELETE a authenticated (debe ser solo-insertar)';
  end if;

  -- #5 — código TEC-#### único bajo inserciones concurrentes (simulado
  -- secuencialmente, pero valida que la secuencia no repite ni dos equipos
  -- quedan con el mismo código).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  declare
    v_codigos text[];
  begin
    with ins as (
      insert into sgc.tec_equipos (nombre, tipo, estado)
      select 'Smoke DA concurrencia ' || g, 'otro', 'en_stock'
        from generate_series(1, 5) g
      returning codigo
    )
    select array_agg(codigo) into v_codigos from ins;
    select count(*) into v_codigo_count from unnest(v_codigos) c;
    if v_codigo_count <> (select count(distinct c) from unnest(v_codigos) c) then
      raise exception 'FAIL #5: codigos TEC-#### duplicados: %', v_codigos;
    end if;
  end;

  -- #6 — kit: mover el kit cascada SOLO a componentes presentes (ya probado
  -- en detalle en la sesión que escribió esta migración; aquí solo el caso
  -- negativo: un componente AUSENTE no se mueve).
  insert into sgc.tec_equipos (nombre, tipo, estado) values ('Smoke DA kit', 'otro', 'en_stock') returning id into v_kit_id;
  insert into sgc.tec_equipos (nombre, tipo, estado, kit_padre_id, presente) values ('Presente', 'otro', 'en_stock', v_kit_id, true) returning id into v_c1;
  insert into sgc.tec_equipos (nombre, tipo, estado, kit_padre_id, presente) values ('Ausente', 'otro', 'extraviado', v_kit_id, false) returning id into v_c2;
  perform sgc.tec_kit_mover(v_kit_id, null, null, 'Smoke ubicacion', null);
  if (select ubicacion from sgc.tec_equipos where id = v_c1) <> 'Smoke ubicacion' then
    raise exception 'FAIL #6a: el componente PRESENTE no se movio con el kit';
  end if;
  if (select ubicacion from sgc.tec_equipos where id = v_c2) is not distinct from 'Smoke ubicacion' then
    raise exception 'FAIL #6b: el componente AUSENTE se movio con el kit (no deberia)';
  end if;

  -- #7 — lote: una fila invalida no tumba las demas (costo no-numerico en una
  -- fila no debe impedir que la otra, valida, se cargue).
  declare
    v_borrador_id uuid;
    v_resultado jsonb;
  begin
    insert into sgc.claude_borradores (usuario_id, tool, params, resumen, idem)
    values (v_admin, 'proponer_equipos_tecnologicos_lote',
      jsonb_build_object('equipos', jsonb_build_array(
        jsonb_build_object('nombre', 'Smoke DA lote valida', 'tipo_clave', 'otro'),
        jsonb_build_object('nombre', 'Smoke DA lote invalida', 'tipo_clave', 'otro', 'costo', 'no-es-numero')
      )),
      'smoke', 'smoke_da_permisos_negativos_lote')
    returning id into v_borrador_id;
    v_resultado := sgc.tec_equipos_lote_confirmar(v_borrador_id, array[0,1]);
    if (v_resultado->>'cargados')::int <> 1 then
      raise exception 'FAIL #7: deberia cargar 1 de 2 filas (la otra con costo invalido), cargo %', v_resultado->>'cargados';
    end if;
  end;

  -- #8 — proponer_equipo_tecnologico vía RPC: ingeniero (sin tecnologia/permiso)
  -- es rechazado por la RLS de tec_equipos al intentar crear/editar.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ingeniero, 'role', 'authenticated')::text, true);
  begin
    perform sgc.tec_equipo_crear_o_actualizar_asistente(p_nombre := 'No deberia crearse', p_tipo_clave := 'otro');
    raise exception 'FAIL #8: ingeniero sin permiso pudo crear un equipo tecnologico';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    -- esperado: 42501 (RLS)
  end;

  raise notice 'OK — 8 asserts de permisos negativos (DA) pasaron: claves-sin-select, gate-propio-sin-atajo-de-modulo, admin-positivo, historial-solo-insert, codigo-unico, kit-cascada-solo-presentes, lote-parcial, RLS-equipo-crear.';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-da-permisos-negativos OK (rollback, nada quedó guardado)');
console.log('   Nota (DA-21): "el conector no expone herramientas de clave" se audita con');
console.log('   scripts/verify-boveda-fuera-de-ia.mjs (estático, en prebuild) — no repetido aquí.');
