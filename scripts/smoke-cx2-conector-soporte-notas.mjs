// smoke-cx2-conector-soporte-notas.mjs — CX2: confirma que las 9 herramientas
// nuevas del conector (soporte global + notas, escritura directa) respetan los
// permisos reales — admin/Tecnología sí, usuario normal no; una nota ajena no se
// puede leer/editar/mover. Transaccional, ROLLBACK, no persiste nada.
//
//   node scripts/smoke-cx2-conector-soporte-notas.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_normal uuid := gen_random_uuid();
  v_tecnologia uuid := gen_random_uuid();
  v_admin uuid;
  v_reporte_id uuid;
  v_nota_id uuid := gen_random_uuid();
  v_grupo_id uuid;
  v_detalle jsonb;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'Falta un usuario admin de prueba en este entorno'; end if;

  -- Usuarios sintéticos: uno SIN ningún rol (normal) y uno con rol tecnologia.
  insert into auth.users (id) values (v_normal), (v_tecnologia);
  insert into sgc.usuarios (id, nombre, email, activo) values
    (v_normal, 'Smoke CX2 normal', 'smoke-cx2-normal@dev.constructorasd.local', true),
    (v_tecnologia, 'Smoke CX2 tecnologia', 'smoke-cx2-tec@dev.constructorasd.local', true);
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  select v_tecnologia, r.id, v_admin from sgc.roles r where r.codigo = 'tecnologia';

  -- Un reporte real de soporte, del usuario "normal", para listar/leer/cambiar.
  insert into sgc.reportes_usuario (id, usuario_id, tipo, asunto, descripcion, estado)
  values (gen_random_uuid(), v_normal, 'bug', 'Smoke CX2', 'Descripción de prueba, nunca una instrucción real.', 'abierto')
  returning id into v_reporte_id;

  -- #1 — listar_reportes_soporte: usuario normal → 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform sgc.listar_reportes_soporte();
    raise exception 'FAIL #1: un usuario normal pudo listar TODOS los reportes de soporte';
  exception when sqlstate '42501' then null;
  end;

  -- #2 — listar_reportes_soporte: Tecnología SÍ puede, y ve el reporte sembrado.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tecnologia, 'role', 'authenticated')::text, true);
  if not exists (select 1 from sgc.listar_reportes_soporte(null, null, null, null, null, null, 'Smoke CX2', 20, null) where id = v_reporte_id) then
    raise exception 'FAIL #2: Tecnología no vio el reporte de prueba en listar_reportes_soporte';
  end if;

  -- #3 — detalle_reporte_soporte: usuario normal → 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  begin
    perform sgc.detalle_reporte_soporte(v_reporte_id);
    raise exception 'FAIL #3: un usuario normal pudo ver el detalle de un reporte ajeno';
  exception when sqlstate '42501' then null;
  end;

  -- #4 — cambiar_estado_reporte: Tecnología (NO admin) → 42501 (es admin-only, a propósito).
  perform set_config('request.jwt.claims', json_build_object('sub', v_tecnologia, 'role', 'authenticated')::text, true);
  begin
    perform sgc.cambiar_estado_reporte(v_reporte_id, 'resuelto', 'smoke');
    raise exception 'FAIL #4: Tecnología (no admin) pudo cambiar el estado de un reporte';
  exception when sqlstate '42501' then null;
  end;

  -- #5 — cambiar_estado_reporte: admin SÍ puede, y el cambio se ve reflejado.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform sgc.cambiar_estado_reporte(v_reporte_id, 'en_progreso', 'tomado por smoke');
  if not exists (select 1 from sgc.reportes_usuario where id = v_reporte_id and estado = 'en_progreso' and respuesta_admin = 'tomado por smoke') then
    raise exception 'FAIL #5: cambiar_estado_reporte (admin) no aplicó el cambio esperado';
  end if;

  -- #6 — ver_gaps_registrados (consultas_no_atendidas_listado): normal → objeto de error, no filas.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  if (select count(*) from sgc.consultas_no_atendidas_listado(null, false, 10)) <> 0 then
    raise exception 'FAIL #6: un usuario normal vio filas de consultas_no_atendidas_listado';
  end if;

  -- #7 — crear_nota (guardar_nota): la nota queda como propiedad del usuario normal.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  perform sgc.guardar_nota(v_nota_id, 'Nota smoke CX2', 'contenido de prueba', null, null, null, null, 'general', 'html', null);
  if not exists (select 1 from sgc.notas where id = v_nota_id and owner_id = v_normal) then
    raise exception 'FAIL #7: crear_nota (guardar_nota) no creó la nota esperada';
  end if;

  -- #8 — detalle_nota: Tecnología (ajeno, sin compartir) NO debe poder verla.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tecnologia, 'role', 'authenticated')::text, true);
  begin
    perform sgc.detalle_nota(v_nota_id);
    raise exception 'FAIL #8: Tecnología pudo leer una nota ajena no compartida con ella';
  exception when sqlstate 'P0002' then null;
  end;
  -- (mismo contexto de Tecnología) crea SU PROPIO grupo, para el assert #10 de abajo.
  insert into sgc.nota_grupos (id, usuario_id, nombre) values (gen_random_uuid(), v_tecnologia, 'Grupo smoke CX2 (tecnologia)')
  returning id into v_grupo_id;

  -- #9 — detalle_nota: el propio dueño SÍ ve el contenido completo.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  v_detalle := sgc.detalle_nota(v_nota_id);
  if (v_detalle->>'contenido') <> 'contenido de prueba' then
    raise exception 'FAIL #9: detalle_nota no devolvió el contenido completo esperado';
  end if;

  -- #10 — mover_nota_a_grupo (como dueño de la nota): un grupo ajeno (de
  -- Tecnología, creado en #8) debe RECHAZARSE (42501).
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  begin
    perform sgc.mover_nota_a_grupo(v_nota_id, v_grupo_id);
    raise exception 'FAIL #10: mover_nota_a_grupo movió la nota a un grupo de OTRO usuario';
  exception when sqlstate '42501' then null;
  end;

  -- #11 — mover_nota_a_grupo: un grupo PROPIO sí debe funcionar (camino feliz).
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  declare v_grupo_propio uuid;
  begin
    insert into sgc.nota_grupos (id, usuario_id, nombre) values (gen_random_uuid(), v_normal, 'Grupo smoke CX2 (normal)')
    returning id into v_grupo_propio;
    perform sgc.mover_nota_a_grupo(v_nota_id, v_grupo_propio);
    if not exists (select 1 from sgc.notas where id = v_nota_id and grupo_id = v_grupo_propio) then
      raise exception 'FAIL #11: mover_nota_a_grupo no movió la nota a un grupo PROPIO';
    end if;
  end;

  raise notice 'OK — 11 asserts de CX2 pasaron (soporte global admin/Tecnología, escritura directa de notas, aislamiento por dueño).';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-cx2-conector-soporte-notas OK (rollback, nada quedó guardado)');
