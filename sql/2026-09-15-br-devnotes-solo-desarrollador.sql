-- BR (post-F10) — Dev notes SOLO para desarrollador/programador (+ admin).
-- Xaviel: "eso de dev notes no debe salirle a nadie más que no sea de tecnología o
-- desarrollador de software / programador". Hoy la RLS usaba es_tecnologia(), que incluye
-- gerencia y dirección (Eduardo, Felipe, Sonia las veían). Se crea es_desarrollador()
-- (admin | tecnologia | encargado_tecnologia) y se usa SOLO para dev notes — el módulo
-- Tecnología general no se toca.

begin;

create or replace function sgc.es_desarrollador()
returns boolean language sql stable security definer set search_path to 'sgc','public'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin','tecnologia','encargado_tecnologia')
  );
$function$;
grant execute on function sgc.es_desarrollador() to authenticated;

-- RLS: la cláusula de dev usa es_desarrollador() (antes es_tecnologia()).
drop policy if exists notas_sel on sgc.notas;
create policy notas_sel on sgc.notas for select to authenticated
  using (sgc.puede_ver_nota(id, auth.uid()) and (ambito <> 'dev' or sgc.es_desarrollador()));

-- Directorio de desarrolladores (para el selector de compartir de dev notes).
create or replace function sgc.directorio_desarrolladores()
returns table(id uuid, nombre text)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select u.id, u.nombre from sgc.usuarios u
  where coalesce(u.activo, true) and not coalesce(u.es_prueba, false)
    and exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and r.codigo in ('admin','tecnologia','encargado_tecnologia'))
  order by u.nombre;
$function$;
grant execute on function sgc.directorio_desarrolladores() to authenticated;

-- compartir_nota: una dev note solo se comparte con desarrolladores (si no, ni la vería
-- y le llegaría una notificación de algo que no puede abrir). Copia viva + guard nuevo.
create or replace function sgc.compartir_nota(p_nota_id uuid, p_usuario_id uuid, p_permiso text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_titulo text;
  v_ambito text;
  v_owner  text;
  v_nuevo  boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_permiso not in ('ver','editar') then
    raise exception 'Permiso inválido (usa ver o editar).';
  end if;

  -- Sólo el dueño de la nota comparte.
  select n.titulo, n.ambito into v_titulo, v_ambito from sgc.notas n
   where n.id = p_nota_id and n.owner_id = v_uid;
  if not found then
    raise exception 'Sólo el dueño de la nota puede compartirla.' using errcode = 'P0001';
  end if;
  if p_usuario_id = v_uid then
    raise exception 'No puedes compartir la nota contigo mismo.';
  end if;

  -- BR — dev notes solo con desarrolladores (Tecnología/programación).
  if v_ambito = 'dev' and not exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = p_usuario_id and r.codigo in ('admin','tecnologia','encargado_tecnologia')
  ) then
    raise exception 'Las notas de desarrollo solo se comparten con Tecnología / desarrollo.' using errcode = 'P0001';
  end if;

  v_nuevo := not exists (
    select 1 from sgc.nota_compartidos
     where nota_id = p_nota_id and usuario_id = p_usuario_id);

  insert into sgc.nota_compartidos (nota_id, usuario_id, permiso)
  values (p_nota_id, p_usuario_id, p_permiso)
  on conflict (nota_id, usuario_id) do update set permiso = excluded.permiso;

  if v_nuevo then
    select u.nombre into v_owner from sgc.usuarios u where u.id = v_uid;
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
    values (
      p_usuario_id, 'nota_compartida',
      'Te compartieron una nota',
      coalesce(v_owner,'Alguien') || ' compartió contigo la nota "' ||
        coalesce(nullif(v_titulo,''),'(sin título)') || '"' ||
        case when p_permiso = 'editar' then ' (puedes editar).' else ' (solo lectura).' end,
      '/notas/' || p_nota_id::text
    );
    begin
      perform sgc.send_push(
        array[p_usuario_id],
        'Te compartieron una nota',
        coalesce(v_owner,'Alguien') || ': ' || coalesce(nullif(v_titulo,''),'(sin título)'),
        jsonb_build_object('ruta', '/notas/' || p_nota_id::text, 'tipo','nota_compartida')
      );
    exception when others then null;
    end;
  end if;
end;
$function$;

commit;
