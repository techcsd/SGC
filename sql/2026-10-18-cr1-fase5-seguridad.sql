-- ============================================================================
-- CR1 — FASE 5: seguridad del conector de Claude.
--
-- "Las RPC de alto riesgo rechazan tokens OAuth" (CONTEXTO-51 §A.4, §B1-f):
-- un token emitido por el servidor OAuth de Supabase trae el claim `client_id`
-- (una sesión normal, NO). Inventario (pg_proc + grep de lo que llama la web
-- como admin): administración de roles/permisos, acceso a dev, fusión de
-- usuarios, permisos extra/combustible retroactivo. Lista completa y el
-- porqué de cada una → docs/CLAUDE-CONECTOR.md.
--
-- Regla 19: cada función se reemplaza con el MISMO cuerpo verificado hoy en
-- vivo contra dev (pg_get_functiondef), solo con `perform
-- sgc.rechazar_si_cliente_oauth();` como primera línea tras `begin`.
-- ============================================================================

begin;

-- ── El guard ─────────────────────────────────────────────────────────────────
create or replace function sgc.rechazar_si_cliente_oauth()
 returns void
 language plpgsql stable
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if nullif(auth.jwt() ->> 'client_id', '') is not null then
    raise exception 'Esta acción no está permitida desde un conector externo (Claude). Hazla directo en el SGC.'
      using errcode = '42501';
  end if;
end;
$function$;
grant execute on function sgc.rechazar_si_cliente_oauth() to authenticated;

-- ── assign_roles — asignar/quitar roles de un usuario ───────────────────────
create or replace function sgc.assign_roles(p_usuario_id uuid, p_rol_ids integer[], p_asignado_por uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_keeps_admin boolean;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then
    raise exception 'No autorizado para asignar roles.';
  end if;

  if p_usuario_id = auth.uid() then
    select exists (
      select 1 from sgc.roles where id = any(p_rol_ids) and codigo = 'admin'
    ) into v_keeps_admin;

    if not v_keeps_admin then
      raise exception 'No puedes quitarte el rol de administrador a ti mismo.';
    end if;
  end if;

  delete from sgc.usuarios_roles where usuario_id = p_usuario_id;

  if p_rol_ids is not null and array_length(p_rol_ids, 1) > 0 then
    insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    select p_usuario_id, rid, p_asignado_por
    from unnest(p_rol_ids) as rid;
  end if;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (p_asignado_por, 'roles_actualizados', p_usuario_id, jsonb_build_object('rol_ids', p_rol_ids));
end;
$function$;

-- ── eliminar_rol ─────────────────────────────────────────────────────────────
create or replace function sgc.eliminar_rol(p_rol_id integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_rol sgc.roles%rowtype;
  v_en_uso integer;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then
    raise exception 'No autorizado para eliminar roles.';
  end if;

  select * into v_rol from sgc.roles where id = p_rol_id;
  if not found then
    raise exception 'Rol no encontrado.';
  end if;

  if v_rol.codigo = 'admin' then
    raise exception 'El rol "admin" no puede eliminarse.';
  end if;

  select count(*) into v_en_uso from sgc.usuarios_roles where rol_id = p_rol_id;
  if v_en_uso > 0 then
    raise exception 'Este rol está asignado a % usuario(s). Reasígnalos antes de eliminarlo.', v_en_uso;
  end if;

  delete from sgc.roles where id = p_rol_id;

  insert into sgc.audit_log (actor_id, action, metadata)
  values (auth.uid(), 'rol_eliminado', jsonb_build_object('rol_id', p_rol_id, 'codigo', v_rol.codigo, 'nombre', v_rol.nombre));
end;
$function$;

-- ── dev_acceso_agregar / dev_acceso_quitar — quién puede entrar a dev (CC2) ──
create or replace function sgc.dev_acceso_agregar(p_email text, p_nota text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then raise exception 'Solo un administrador.'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Correo requerido.'; end if;
  insert into sgc.dev_acceso (email, nota, creado_por)
  values (lower(trim(p_email)), nullif(trim(p_nota), ''), auth.uid())
  on conflict (email) do update set nota = excluded.nota;
end;
$function$;

create or replace function sgc.dev_acceso_quitar(p_email text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then raise exception 'Solo un administrador.'; end if;
  delete from sgc.dev_acceso where email = lower(trim(p_email));
end;
$function$;

-- ── fusionar_usuarios — destructivo (desactiva + reapunta FKs) ──────────────
create or replace function sgc.fusionar_usuarios(p_canonico uuid, p_duplicado uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  r record;
  v_reapuntadas int := 0;
  v_tablas_ok text[] := '{}';
  v_conflictos text[] := '{}';
  v_can sgc.usuarios; v_dup sgc.usuarios;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_canonico is null or p_duplicado is null or p_canonico = p_duplicado then
    raise exception 'Indica dos usuarios distintos (canónico y duplicado).';
  end if;
  select * into v_can from sgc.usuarios where id = p_canonico;
  select * into v_dup from sgc.usuarios where id = p_duplicado;
  if v_can.id is null or v_dup.id is null then raise exception 'Usuario no encontrado.'; end if;
  if v_can.fusionado_en is not null then raise exception 'El canónico ya está fusionado en otro usuario.'; end if;
  if v_dup.fusionado_en is not null then raise exception 'El duplicado ya fue fusionado.'; end if;

  for r in
    select (c.conrelid::regclass)::text as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='sgc.usuarios'::regclass and array_length(c.conkey,1)=1
      and c.conrelid <> 'sgc.usuarios'::regclass
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tabla, r.columna, r.columna)
        using p_canonico, p_duplicado;
      get diagnostics v_reapuntadas = row_count;
      if v_reapuntadas > 0 then v_tablas_ok := array_append(v_tablas_ok, r.tabla || '.' || r.columna); end if;
    exception when unique_violation then
      v_conflictos := array_append(v_conflictos, r.tabla || '.' || r.columna);
    end;
  end loop;

  update sgc.usuarios
    set activo = false, fusionado_en = p_canonico
    where id = p_duplicado;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'usuarios_fusionados', p_duplicado, jsonb_build_object(
    'canonico', p_canonico, 'canonico_nombre', v_can.nombre,
    'duplicado_nombre', v_dup.nombre, 'duplicado_cedula', v_dup.cedula, 'duplicado_email', v_dup.email,
    'tablas_reapuntadas', to_jsonb(v_tablas_ok), 'conflictos', to_jsonb(v_conflictos)));

  return jsonb_build_object(
    'ok', true,
    'canonico', p_canonico,
    'duplicado', p_duplicado,
    'tablas_reapuntadas', v_tablas_ok,
    'conflictos', v_conflictos);
end;
$function$;

-- ── hacer_conductor — otorga rol chofer_transportista/chofer_privado ────────
create or replace function sgc.hacer_conductor(p_usuario uuid, p_rol text DEFAULT 'chofer_transportista'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_u record; v_cond_id uuid; v_rol_id int; v_creada boolean := false;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_rol not in ('chofer_transportista','chofer_privado') then
    raise exception 'Rol inválido: %', p_rol using errcode = '22023';
  end if;

  select id, nombre, cedula, telefono into v_u from sgc.usuarios where id = p_usuario;
  if v_u.id is null then raise exception 'Usuario no encontrado' using errcode = 'P0002'; end if;

  select id into v_cond_id from sgc.conductores where usuario_id = p_usuario limit 1;
  if v_cond_id is null then
    insert into sgc.conductores (nombre, cedula, telefono, usuario_id, activo)
    values (coalesce(v_u.nombre,'Conductor'), nullif(regexp_replace(coalesce(v_u.cedula,''),'\D','','g'),''), v_u.telefono, p_usuario, true)
    returning id into v_cond_id;
    v_creada := true;
  end if;

  select id into v_rol_id from sgc.roles where codigo = p_rol;
  if v_rol_id is null then raise exception 'No existe el rol %. Configúralo en Administración › Roles.', p_rol using errcode = '22023'; end if;
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  values (p_usuario, v_rol_id, auth.uid())
  on conflict (usuario_id, rol_id) do nothing;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (auth.uid(), 'usuario_hecho_conductor', p_usuario,
          jsonb_build_object('conductor_id', v_cond_id, 'rol', p_rol, 'ficha_creada', v_creada));

  return jsonb_build_object('conductor_id', v_cond_id, 'creada', v_creada, 'rol', p_rol);
end;
$function$;

-- ── permisos extra / combustible retroactivo (otorgar + revocar) ────────────
create or replace function sgc.otorgar_permiso_extra(p_usuario_id uuid, p_permiso text, p_motivo text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'public'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  insert into sgc.usuario_permisos_extra (usuario_id, permiso, otorgado_por, motivo)
    values (p_usuario_id, p_permiso, auth.uid(), p_motivo)
  on conflict (usuario_id, permiso) do update
    set activo = true, otorgado_por = auth.uid(), otorgado_at = now(),
        revocado_por = null, revocado_at = null, motivo = coalesce(excluded.motivo, sgc.usuario_permisos_extra.motivo);
end;
$function$;

create or replace function sgc.revocar_permiso_extra(p_usuario_id uuid, p_permiso text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'public'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  update sgc.usuario_permisos_extra
     set activo = false, revocado_por = auth.uid(), revocado_at = now()
   where usuario_id = p_usuario_id and permiso = p_permiso;
end;
$function$;

create or replace function sgc.otorgar_permiso_combustible_retro(p_usuario_id uuid, p_dias_max integer, p_vence date, p_motivo text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Flota puede otorgar permisos de registro retroactivo.' using errcode = '42501';
  end if;
  if p_usuario_id is null then raise exception 'Indica el usuario.' using errcode = '22023'; end if;
  if coalesce(p_vence, current_date - 1) < current_date then
    raise exception 'El vencimiento debe ser hoy o futuro.' using errcode = '22023';
  end if;
  update sgc.combustible_permisos_retro set activo = false where usuario_id = p_usuario_id and activo;
  insert into sgc.combustible_permisos_retro (usuario_id, dias_max, vence, motivo, otorgado_por)
  values (p_usuario_id, coalesce(p_dias_max, 7), p_vence, nullif(btrim(p_motivo),''), auth.uid())
  returning id into v_id;
  perform sgc.notificar(
    p_usuario_id, 'combustible_retro_permitida',
    'Puedes registrar echadas con fecha pasada',
    'Se te autorizó registrar echadas de combustible retroactivas (hasta ' || coalesce(p_dias_max, 7) ||
      ' días atrás) hasta el ' || to_char(p_vence, 'DD/MM/YYYY') || '.',
    '/flota/combustible');
  return v_id;
end $function$;

create or replace function sgc.revocar_permiso_combustible_retro(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo Flota puede revocar permisos de registro retroactivo.' using errcode = '42501';
  end if;
  update sgc.combustible_permisos_retro set activo = false where id = p_id;
  if not found then raise exception 'Permiso no encontrado.' using errcode = '22023'; end if;
end $function$;

-- ── set_rol_comparte_ubicacion — config de un rol (tracking GPS) ────────────
create or replace function sgc.set_rol_comparte_ubicacion(p_rol_id integer, p_valor boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  perform sgc.rechazar_si_cliente_oauth();
  if not sgc.is_admin() then raise exception 'Solo un administrador puede cambiar el rol'; end if;
  update sgc.roles set comparte_ubicacion = coalesce(p_valor, false) where id = p_rol_id;
end;
$function$;

commit;
