// CZ1/CZ2 -- smoke transaccional (ROLLBACK) de la biblioteca de Cotizaciones.
// Cubre: crear/actualizar/descartar/restaurar, vincular/desvincular compra y
// equipo (estado pasa a 'usada' al vincular una compra), cotizacion_de_equipo
// (directa le gana a la elegida del origen_solicitud_compra_id), y que un
// usuario SIN modulo tecnologia/permiso granular no pueda operar.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_tec_id uuid;
  v_ajeno_id uuid;
  v_cot_id uuid;
  v_cot2_id uuid;
  v_sol_id uuid;
  v_equipo_id uuid;
  v_dir record;
begin
  select ur.usuario_id into v_tec_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'tecnologia'=any(r.modulos) or r.codigo='admin' limit 1;
  -- OJO (lección CY21): un usuario con VARIAS roles puede tener una fila que NO
  -- da tecnologia/admin aunque OTRA de sus roles sí lo dé -- hay que excluir por
  -- la UNION de TODOS sus roles, no por una sola fila de usuarios_roles.
  select u.id into v_ajeno_id
  from sgc.usuarios u
  where u.id <> v_tec_id
    and exists (select 1 from sgc.usuarios_roles ur3 where ur3.usuario_id = u.id)
    and not exists (
      select 1 from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id
      where ur2.usuario_id = u.id and ('tecnologia' = any(r2.modulos) or r2.codigo = 'admin')
    )
  limit 1;
  if v_tec_id is null or v_ajeno_id is null then
    raise exception 'FALLO_SETUP: faltan 2 usuarios distintos (uno con modulo tecnologia/admin, uno sin ninguno)';
  end if;

  -- ── crear (con sesion de tecnologia) ───────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_tec_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_cot_id := sgc.cotizacion_crear('CZ1-SMOKE Dell Latitude', 'Office Depot', current_date, 'USD', 500, 90, 590, null, null, null, null, 'nota de prueba');
  if v_cot_id is null then raise exception 'FALLO: cotizacion_crear no devolvio id'; end if;
  raise notice 'OK: cotizacion_crear';

  -- ── actualizar ──────────────────────────────────────────────────────────
  perform sgc.cotizacion_actualizar(v_cot_id, 'CZ1-SMOKE Dell Latitude 5440', 'Office Depot', current_date, 'USD', 520, 93.6, 613.6, 'actualizada');
  if (select titulo from sgc.tec_cotizaciones where id = v_cot_id) <> 'CZ1-SMOKE Dell Latitude 5440' then
    raise exception 'FALLO: cotizacion_actualizar no aplico el nuevo titulo';
  end if;
  raise notice 'OK: cotizacion_actualizar';

  -- ── vincular a una compra tecnologica: debe pasar a usada ──────────────
  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, categoria, notas)
    values (null, v_tec_id, 'borrador', 'tecnologia', 'CZ1-SMOKE compra') returning id into v_sol_id;
  perform sgc.cotizacion_vincular_compra(v_cot_id, v_sol_id);
  if (select estado from sgc.tec_cotizaciones where id = v_cot_id) <> 'usada' then
    raise exception 'FALLO: vincular a una compra deberia marcar la cotizacion como usada';
  end if;
  if not exists (select 1 from sgc.tec_cotizacion_compras where cotizacion_id = v_cot_id and solicitud_compra_id = v_sol_id) then
    raise exception 'FALLO: no quedo el vinculo cotizacion-compra';
  end if;
  raise notice 'OK: cotizacion_vincular_compra (estado -> usada)';

  -- ── vincular a un equipo: cotizacion_de_equipo debe resolver DIRECTA ───
  insert into sgc.tec_equipos (nombre, tipo, origen_solicitud_compra_id)
    values ('CZ1-SMOKE Laptop', 'laptop', v_sol_id) returning id into v_equipo_id;
  perform sgc.cotizacion_vincular_equipo(v_cot_id, v_equipo_id, 0);
  select * into v_dir from sgc.cotizacion_de_equipo(v_equipo_id);
  if v_dir.cotizacion_id is distinct from v_cot_id or v_dir.directa is distinct from true then
    raise exception 'FALLO: cotizacion_de_equipo deberia resolver el vinculo DIRECTO, dio %', v_dir;
  end if;
  raise notice 'OK: cotizacion_vincular_equipo + cotizacion_de_equipo (directa)';

  -- ── desvincular equipo: ahora cae a la ELEGIDA del origen de la compra ──
  perform sgc.cotizacion_desvincular_equipo(v_cot_id, v_equipo_id);
  select * into v_dir from sgc.cotizacion_de_equipo(v_equipo_id);
  if v_dir.cotizacion_id is distinct from v_cot_id or v_dir.directa is distinct from false then
    raise exception 'FALLO: sin vinculo directo deberia caer a la usada del origen_solicitud_compra_id, dio %', v_dir;
  end if;
  raise notice 'OK: cotizacion_de_equipo cae al origen de la compra cuando no hay vinculo directo';

  -- ── descartar / restaurar ───────────────────────────────────────────────
  v_cot2_id := sgc.cotizacion_crear('CZ1-SMOKE descartable', null, null, 'DOP', null, null, null, null, null, null, null);
  perform sgc.cotizacion_descartar(v_cot2_id);
  if (select estado from sgc.tec_cotizaciones where id = v_cot2_id) <> 'descartada' then
    raise exception 'FALLO: cotizacion_descartar no aplico';
  end if;
  perform sgc.cotizacion_restaurar(v_cot2_id);
  if (select estado from sgc.tec_cotizaciones where id = v_cot2_id) <> 'vigente' then
    raise exception 'FALLO: cotizacion_restaurar no aplico';
  end if;
  raise notice 'OK: cotizacion_descartar / cotizacion_restaurar';

  -- ── adjuntar cotizacion desde Compras (CO8/CQ1) tambien registra biblioteca
  perform sgc.compra_tec_adjuntar_cotizacion(v_sol_id, 'cotizacion', 'Proveedor CZ1', 100, 'biblioteca/CZ1-SMOKE/test.pdf', 'test.pdf');
  if not exists (
    select 1 from sgc.tec_cotizaciones c join sgc.solicitud_compra_adjuntos a on a.id = c.adjunto_id
    where a.solicitud_id = v_sol_id and a.path = 'biblioteca/CZ1-SMOKE/test.pdf'
  ) then
    raise exception 'FALLO: compra_tec_adjuntar_cotizacion no registro en la biblioteca (DZ-03)';
  end if;
  raise notice 'OK: compra_tec_adjuntar_cotizacion registra tambien en la biblioteca (DZ-03)';

  reset role;

  -- ── negativo: usuario SIN modulo tecnologia / permiso granular ──────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from sgc.tec_cotizaciones where id = v_cot_id) then
    raise exception 'FALLO: un usuario ajeno pudo VER la cotizacion (RLS)';
  end if;
  begin
    perform sgc.cotizacion_crear('CZ1-SMOKE no deberia crear', null, null, 'DOP', null, null, null, null, null, null, null);
    raise exception 'FALLO: un usuario ajeno pudo CREAR una cotizacion';
  exception when others then
    if sqlerrm like '%No autorizado%' then raise notice 'OK: cotizacion_crear niega a quien no tiene tecnologia ni el permiso granular'; else raise; end if;
  end;
  reset role;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CZ1: cotizacion_crear/actualizar/descartar/restaurar, vincular_compra (-> usada), vincular/desvincular_equipo, cotizacion_de_equipo (directa > origen), compra_tec_adjuntar_cotizacion registra biblioteca, negativo sin modulo/permiso (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CZ1 smoke falló:', e.message.slice(0, 2000));
  process.exit(1);
}
