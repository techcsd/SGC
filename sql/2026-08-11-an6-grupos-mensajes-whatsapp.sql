-- =============================================================================
-- PROMPT-7 FASE 5 (AN6) — Ronda 11/08/2026 tarde. SGC padre.
-- Grupos de Mensajes tipo WhatsApp (aditivo sobre el modelo AJ5, cero chat
-- paralelo): info del grupo (nombre/descripción/avatar editables), lista de
-- participantes con rol (admin/miembro), agregar/quitar/promover/salir, y
-- eventos del sistema en el hilo ("X agregó a Y").
--
-- Permisos (asunción AN6, confirmar con Xaviel): el CREADOR y los ADMIN del grupo
-- gestionan (editar, agregar, quitar, promover). Cualquier miembro puede SALIR.
-- Al salir el último admin, se promueve al participante más antiguo (sin huérfanos).
-- =============================================================================

begin;

-- ── Esquema (aditivo) ────────────────────────────────────────────────────────
alter table sgc.conversaciones
  add column if not exists descripcion text,
  add column if not exists avatar_path text;

alter table sgc.conversacion_participantes
  add column if not exists rol text not null default 'miembro';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conv_part_rol_chk') then
    alter table sgc.conversacion_participantes
      add constraint conv_part_rol_chk check (rol in ('admin','miembro'));
  end if;
end $$;

-- Tipo de mensaje: 'texto' normal | 'sistema' evento ("X agregó a Y").
alter table sgc.mensajes
  add column if not exists tipo text not null default 'texto';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mensajes_tipo_chk') then
    alter table sgc.mensajes add constraint mensajes_tipo_chk check (tipo in ('texto','sistema'));
  end if;
end $$;

-- Backfill: el creador de cada grupo es admin de su grupo.
update sgc.conversacion_participantes cp
set rol = 'admin'
from sgc.conversaciones c
where c.id = cp.conversacion_id and c.tipo = 'grupo'
  and c.creado_por = cp.usuario_id and cp.rol <> 'admin';

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function sgc.es_admin_grupo(p_conv uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (
    select 1 from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = auth.uid() and rol = 'admin'
  );
$$;
grant execute on function sgc.es_admin_grupo(uuid) to authenticated;

-- Evento de sistema en el hilo (autor = quien lo provoca).
create or replace function sgc.grupo_evento(p_conv uuid, p_texto text)
returns void
language sql security definer
set search_path to 'sgc', 'pg_temp'
as $$
  insert into sgc.mensajes (conversacion_id, autor_id, contenido, tipo)
  values (p_conv, auth.uid(), p_texto, 'sistema');
$$;

-- ── Info del grupo (meta + participantes con nombre/rol) ─────────────────────
create or replace function sgc.grupo_info(p_conv uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v jsonb;
begin
  if not sgc.es_participante(p_conv) then
    raise exception 'No perteneces a este grupo.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'id', c.id,
    'tipo', c.tipo,
    'nombre', c.nombre,
    'descripcion', c.descripcion,
    'avatar_path', c.avatar_path,
    'creado_por', c.creado_por,
    'created_at', c.created_at,
    'mi_rol', (select cp.rol from sgc.conversacion_participantes cp
               where cp.conversacion_id = c.id and cp.usuario_id = auth.uid()),
    'participantes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'usuario_id', u.id,
        'nombre', u.nombre,
        'email', u.email,
        'rol', cp.rol,
        'added_at', cp.added_at,
        'es_creador', (u.id = c.creado_por)
      ) order by (cp.rol = 'admin') desc, u.nombre)
      from sgc.conversacion_participantes cp
      join sgc.usuarios u on u.id = cp.usuario_id
      where cp.conversacion_id = c.id
    ), '[]'::jsonb)
  ) into v
  from sgc.conversaciones c where c.id = p_conv;
  return v;
end;
$$;
grant execute on function sgc.grupo_info(uuid) to authenticated;

-- ── Editar nombre/descripción (admin) ────────────────────────────────────────
create or replace function sgc.grupo_editar(p_conv uuid, p_nombre text, p_descripcion text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_old text;
begin
  if not sgc.es_admin_grupo(p_conv) then
    raise exception 'Solo un admin del grupo puede editarlo.' using errcode = 'P0001';
  end if;
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El grupo necesita un nombre.';
  end if;
  select nombre into v_old from sgc.conversaciones where id = p_conv;
  update sgc.conversaciones
    set nombre = trim(p_nombre), descripcion = nullif(trim(coalesce(p_descripcion,'')),'')
    where id = p_conv and tipo = 'grupo';
  if coalesce(v_old,'') <> trim(p_nombre) then
    perform sgc.grupo_evento(p_conv, (select nombre from sgc.usuarios where id = auth.uid())
      || ' cambió el nombre del grupo a "' || trim(p_nombre) || '"');
  end if;
end;
$$;
grant execute on function sgc.grupo_editar(uuid, text, text) to authenticated;

-- ── Fijar avatar (admin) ─────────────────────────────────────────────────────
create or replace function sgc.grupo_set_avatar(p_conv uuid, p_path text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_admin_grupo(p_conv) then
    raise exception 'Solo un admin del grupo puede cambiar la foto.' using errcode = 'P0001';
  end if;
  update sgc.conversaciones set avatar_path = p_path where id = p_conv and tipo = 'grupo';
  perform sgc.grupo_evento(p_conv, (select nombre from sgc.usuarios where id = auth.uid())
    || ' cambió la foto del grupo');
end;
$$;
grant execute on function sgc.grupo_set_avatar(uuid, text) to authenticated;

-- ── Agregar participante (admin) ─────────────────────────────────────────────
create or replace function sgc.grupo_agregar(p_conv uuid, p_usuario_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_ya boolean; v_nombre text;
begin
  if not sgc.es_admin_grupo(p_conv) then
    raise exception 'Solo un admin del grupo puede agregar participantes.' using errcode = 'P0001';
  end if;
  if (select tipo from sgc.conversaciones where id = p_conv) <> 'grupo' then
    raise exception 'Solo se pueden agregar participantes a un grupo.';
  end if;
  select exists(select 1 from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = p_usuario_id) into v_ya;
  if v_ya then return; end if;
  insert into sgc.conversacion_participantes (conversacion_id, usuario_id, rol)
    values (p_conv, p_usuario_id, 'miembro');
  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  perform sgc.grupo_evento(p_conv, (select nombre from sgc.usuarios where id = auth.uid())
    || ' agregó a ' || coalesce(v_nombre,'alguien'));
end;
$$;
grant execute on function sgc.grupo_agregar(uuid, uuid) to authenticated;

-- ── Quitar participante (admin) ──────────────────────────────────────────────
create or replace function sgc.grupo_quitar(p_conv uuid, p_usuario_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_nombre text; v_creador uuid;
begin
  if not sgc.es_admin_grupo(p_conv) then
    raise exception 'Solo un admin del grupo puede quitar participantes.' using errcode = 'P0001';
  end if;
  select creado_por into v_creador from sgc.conversaciones where id = p_conv;
  if p_usuario_id = v_creador then
    raise exception 'No puedes quitar al creador del grupo.';
  end if;
  delete from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = p_usuario_id;
  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  perform sgc.grupo_evento(p_conv, (select nombre from sgc.usuarios where id = auth.uid())
    || ' quitó a ' || coalesce(v_nombre,'alguien'));
end;
$$;
grant execute on function sgc.grupo_quitar(uuid, uuid) to authenticated;

-- ── Promover / degradar admin (admin) ────────────────────────────────────────
create or replace function sgc.grupo_promover(p_conv uuid, p_usuario_id uuid, p_admin boolean)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_nombre text; v_creador uuid;
begin
  if not sgc.es_admin_grupo(p_conv) then
    raise exception 'Solo un admin del grupo puede cambiar roles.' using errcode = 'P0001';
  end if;
  select creado_por into v_creador from sgc.conversaciones where id = p_conv;
  if p_usuario_id = v_creador and not p_admin then
    raise exception 'El creador del grupo no puede dejar de ser admin.';
  end if;
  update sgc.conversacion_participantes
    set rol = case when p_admin then 'admin' else 'miembro' end
    where conversacion_id = p_conv and usuario_id = p_usuario_id;
  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;
  perform sgc.grupo_evento(p_conv, (select nombre from sgc.usuarios where id = auth.uid())
    || case when p_admin then ' nombró admin a ' else ' quitó admin a ' end
    || coalesce(v_nombre,'alguien'));
end;
$$;
grant execute on function sgc.grupo_promover(uuid, uuid, boolean) to authenticated;

-- ── Salir del grupo (cualquier miembro) ──────────────────────────────────────
create or replace function sgc.grupo_salir(p_conv uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_me uuid := auth.uid(); v_era_admin boolean; v_quedan_admins int; v_nuevo uuid; v_nombre text;
begin
  if not sgc.es_participante(p_conv) then return; end if;
  select rol = 'admin' into v_era_admin from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = v_me;
  select nombre into v_nombre from sgc.usuarios where id = v_me;

  delete from sgc.conversacion_participantes
    where conversacion_id = p_conv and usuario_id = v_me;
  perform sgc.grupo_evento(p_conv, coalesce(v_nombre,'Alguien') || ' salió del grupo');

  -- Si el que salió era el único admin y quedan miembros, promover al más antiguo.
  if v_era_admin then
    select count(*) into v_quedan_admins from sgc.conversacion_participantes
      where conversacion_id = p_conv and rol = 'admin';
    if v_quedan_admins = 0 then
      select usuario_id into v_nuevo from sgc.conversacion_participantes
        where conversacion_id = p_conv order by added_at asc limit 1;
      if v_nuevo is not null then
        update sgc.conversacion_participantes set rol = 'admin'
          where conversacion_id = p_conv and usuario_id = v_nuevo;
        perform sgc.grupo_evento(p_conv,
          (select nombre from sgc.usuarios where id = v_nuevo) || ' ahora es admin del grupo');
      end if;
    end if;
  end if;
end;
$$;
grant execute on function sgc.grupo_salir(uuid) to authenticated;

-- ── crear_grupo: el creador queda como ADMIN del grupo ───────────────────────
create or replace function sgc.crear_grupo(p_nombre text, p_participantes uuid[])
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_id uuid; v_me uuid := auth.uid();
begin
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El grupo necesita un nombre.';
  end if;
  insert into sgc.conversaciones (tipo, nombre, creado_por)
    values ('grupo', trim(p_nombre), v_me) returning id into v_id;
  -- miembros
  insert into sgc.conversacion_participantes (conversacion_id, usuario_id, rol)
    select v_id, uid, 'miembro' from unnest(coalesce(p_participantes, '{}')) as uid
    on conflict do nothing;
  -- creador = admin
  insert into sgc.conversacion_participantes (conversacion_id, usuario_id, rol)
    values (v_id, v_me, 'admin')
    on conflict (conversacion_id, usuario_id) do update set rol = 'admin';
  return v_id;
end;
$$;
grant execute on function sgc.crear_grupo(text, uuid[]) to authenticated;

commit;
