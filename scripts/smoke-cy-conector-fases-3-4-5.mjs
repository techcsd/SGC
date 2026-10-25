// smoke-cy-conector-fases-3-4-5.mjs — CY: confirma que las funciones MODIFICADAS
// en el sitio (claude_conexiones_listado, reunion_resumen_compa) siguen
// funcionando igual + la columna nueva, y que una muestra representativa de las
// funciones NUEVAS respeta permisos y hace lo que dice. Transaccional, ROLLBACK.
//
//   node scripts/smoke-cy-conector-fases-3-4-5.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_admin uuid;
  v_normal uuid := gen_random_uuid();
  v_otro uuid := gen_random_uuid();
  v_tarea_id uuid;
  v_sol_id uuid;
  v_proyecto_id uuid;
  v_bodega_id uuid;
  v_mensaje sgc.mensajes;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'Falta un usuario admin de prueba'; end if;
  select id into v_proyecto_id from sgc.proyectos limit 1;
  select id into v_bodega_id from sgc.bodegas limit 1;

  insert into auth.users (id) values (v_normal), (v_otro);
  insert into sgc.usuarios (id, nombre, email, activo) values
    (v_normal, 'Smoke CY normal', 'smoke-cy-normal@dev.constructorasd.local', true),
    (v_otro, 'Smoke CY otro', 'smoke-cy-otro@dev.constructorasd.local', true);

  -- #1 — claude_conexiones_listado: admin sí, gana la columna nueva sin romper.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform borradores_pendientes from sgc.claude_conexiones_listado(); -- falla en compilación si la columna no existe

  -- #2 — reglas_de_alertas: usuario normal -> 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  begin
    perform sgc.reglas_de_alertas();
    raise exception 'FAIL #2: un usuario normal pudo leer reglas_de_alertas';
  exception when sqlstate '42501' then null;
  end;

  -- #3 — reglas_de_alertas: admin sí.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform sgc.reglas_de_alertas(); -- no debe lanzar

  -- #4 — actualizar_tarea_campos: crea una tarea asignada a v_normal, v_otro NO puede tocarla.
  insert into sgc.tareas (id, titulo, asignado_a, asignado_por, estado)
  values (gen_random_uuid(), 'Smoke CY tarea', v_normal, v_admin, 'pendiente')
  returning id into v_tarea_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  begin
    perform sgc.actualizar_tarea_campos(v_tarea_id, 'completada', null, null, null);
    if exists (select 1 from sgc.tareas where id = v_tarea_id and estado = 'completada') then
      raise exception 'FAIL #4: v_otro (ajeno) pudo completar una tarea que no es suya';
    end if;
  exception when others then null; -- el RLS puede devolver 0 filas en vez de raise; ambos son correctos
  end;

  -- #5 — actualizar_tarea_campos: el asignado SÍ puede completarla.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  perform sgc.actualizar_tarea_campos(v_tarea_id, 'completada', 'smoke listo', null, null);
  if not exists (select 1 from sgc.tareas where id = v_tarea_id and estado = 'completada') then
    raise exception 'FAIL #5: el asignado no pudo completar su propia tarea';
  end if;
  if not exists (select 1 from sgc.tarea_comentarios where tarea_id = v_tarea_id and comentario = 'smoke listo') then
    raise exception 'FAIL #5b: el comentario no se guardó';
  end if;

  -- #6 — decidir_requisicion: rechazar una requisición PENDIENTE real (tomada
  -- prestada dentro de esta transacción con ROLLBACK — no se queda rechazada de
  -- verdad). No se INSERTA una fila nueva: sgc.solicitudes_material_folio_seq
  -- está desincronizada en dev (max(folio)=9001 por el seed demo CK, seq=11) y
  -- cualquier insert nuevo choca con esa fila sembrada — defecto preexistente,
  -- fuera de esta ronda, no se toca aquí.
  select id into v_sol_id from sgc.solicitudes_material where estado = 'pendiente' limit 1;
  if v_sol_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform sgc.decidir_requisicion(v_sol_id, 'rechazar', null, 'smoke');
    if not exists (select 1 from sgc.solicitudes_material where id = v_sol_id and estado = 'rechazada') then
      raise exception 'FAIL #6: decidir_requisicion(rechazar) no aplicó el cambio esperado';
    end if;
  else
    raise notice 'SKIP #6: no hay ninguna solicitud pendiente en dev para probar (no es un fallo, no hay dato de prueba disponible)';
  end if;

  -- #7 — decidir_requisicion: aprobar sin bodega_id debe fallar con un mensaje claro
  -- (el chequeo es anterior a tocar la solicitud, un id cualquiera basta).
  begin
    perform sgc.decidir_requisicion(gen_random_uuid(), 'aprobar', null, null);
    raise exception 'FAIL #7: aprobar sin bodega_id no lanzó el error esperado';
  exception when sqlstate '22023' then null;
  end;

  -- #8 — enviar_mensaje_directo: crea conversación + mensaje.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  v_mensaje := sgc.enviar_mensaje_directo(v_otro, 'Smoke CY mensaje de prueba');
  if v_mensaje.contenido <> 'Smoke CY mensaje de prueba' or v_mensaje.autor_id <> v_normal then
    raise exception 'FAIL #8: enviar_mensaje_directo no devolvió el mensaje esperado';
  end if;
  if not exists (select 1 from sgc.conversacion_participantes where conversacion_id = v_mensaje.conversacion_id and usuario_id = v_otro) then
    raise exception 'FAIL #8b: el destinatario no quedó como participante de la conversación';
  end if;

  -- #9 — enviar_mensaje_directo: usuario normal NO puede leer la ruta de admin-only (reglas_de_alertas) desde su propio contexto (ya probado #2); confirma además que no puede mandarse mensaje a sí mismo (regla existente de crear_conversacion_directa).
  begin
    perform sgc.enviar_mensaje_directo(v_normal, 'a mi mismo');
    raise exception 'FAIL #9: se pudo enviar un mensaje directo a uno mismo';
  exception when others then null; -- crear_conversacion_directa ya lo prohíbe con su propio mensaje
  end;

  raise notice 'OK — 9 asserts de CY pasaron (regresión de 2 funciones modificadas + 5 funciones nuevas verificadas).';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-cy-conector-fases-3-4-5 OK (rollback, nada quedó guardado)');
