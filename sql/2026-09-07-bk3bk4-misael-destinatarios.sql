-- BK3/BK4 (solicitud Xaviel) — (1) marcar a Misael como chofer del incentivo;
-- (2) destinatarios del informe DIARIO por USUARIO (precisos, ej. "solo Eduardo")
-- además de por rol, editables desde la UI.

begin;

-- ── 1) Misael es chofer (empieza a puntuar desde la semana en curso) ─────────
update sgc.incentivo_participante
   set es_chofer = true, actualizado_en = now()
 where usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7'
   and es_chofer is distinct from true;
insert into sgc.incentivo_participante_audit (conductor_id, usuario_id, participa, es_chofer, motivo, cambiado_por)
select (select id from sgc.conductores c where c.usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7' limit 1),
       'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7', participa, true, 'Marcado como chofer (solicitud Xaviel)', null
  from sgc.incentivo_participante where usuario_id = 'ccd411b3-2bfc-49ef-a2e3-83406b89b2d7';

-- ── 2) Destinatarios del diario: lista de USUARIOS (además de roles) ─────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('incentivo_diario_usuarios','','Usuarios (IDs) que reciben el informe DIARIO de incentivo — además de incentivo_diario_roles')
on conflict (clave) do nothing;

-- Ahora: solo Eduardo NG, sin roles (se puede ampliar desde la UI).
update sgc.parametros set valor = '2725c827-aec2-4e0c-90ac-dea1ee2b2350'
 where clave = 'incentivo_diario_usuarios';
update sgc.parametros set valor = '' where clave = 'incentivo_diario_roles';

-- Resolver = usuarios explícitos UNION usuarios por rol (si se configuran roles).
create or replace function sgc.destinatarios_informe_diario()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and (
      u.id::text = any (
        select trim(x) from unnest(string_to_array(
          coalesce((select valor from sgc.parametros where clave='incentivo_diario_usuarios'),''), ',')) x
        where trim(x) <> '')
      or exists (
        select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id
          and r.codigo = any (sgc.param_csv('incentivo_diario_roles','')))
    );
$function$;
grant execute on function sgc.destinatarios_informe_diario() to authenticated, service_role;

-- Lista actual (para la UI): usuarios explícitos del diario.
create or replace function sgc.incentivo_diario_destinatarios()
returns table(usuario_id uuid, nombre text, email text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, u.email
  from sgc.usuarios u
  where (sgc.is_admin() or sgc.puede_gestionar_incentivos())
    and u.id::text = any (
      select trim(x) from unnest(string_to_array(
        coalesce((select valor from sgc.parametros where clave='incentivo_diario_usuarios'),''), ',')) x
      where trim(x) <> '')
  order by u.nombre;
$function$;
grant execute on function sgc.incentivo_diario_destinatarios() to authenticated, service_role;

-- Agregar / quitar un usuario de la lista del diario (admin/gestión).
create or replace function sgc.set_incentivo_diario_destinatario(p_usuario_id uuid, p_incluir boolean)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_arr text[];
begin
  if not (sgc.is_admin() or sgc.puede_gestionar_incentivos()) then
    raise exception 'No tienes permiso para cambiar los destinatarios del informe.';
  end if;
  select array(select distinct trim(x)
                 from unnest(string_to_array(coalesce(valor,''), ',')) x
                where trim(x) <> '')
    into v_arr
    from sgc.parametros where clave = 'incentivo_diario_usuarios';
  v_arr := coalesce(v_arr, '{}');
  if coalesce(p_incluir, false) then
    v_arr := array(select distinct e from unnest(v_arr || p_usuario_id::text) e);
  else
    v_arr := array(select e from unnest(v_arr) e where e <> p_usuario_id::text);
  end if;
  insert into sgc.parametros (clave, valor) values ('incentivo_diario_usuarios', array_to_string(v_arr, ','))
  on conflict (clave) do update set valor = excluded.valor, updated_at = now();
end;
$function$;
grant execute on function sgc.set_incentivo_diario_destinatario(uuid,boolean) to authenticated, service_role;

commit;
