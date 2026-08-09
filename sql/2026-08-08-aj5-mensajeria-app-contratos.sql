-- =============================================================================
-- PROMPT-13 FASE 5 (AJ5) — Contratos de MENSAJERÍA para la app (mismo modelo web,
-- CERO chat paralelo). Ronda 08/08/2026 (IDs AJ). Aditivo, idempotente.
--
-- La web hoy lee/escribe directo contra las tablas (sin RPCs de listado). La app
-- necesita RPCs estables + envío idempotente (outbox) + push. Se añaden RPCs sin
-- tocar el modelo (conversaciones / conversacion_participantes / mensajes) ni la
-- web (que puede migrar a estos RPCs después, o seguir con acceso directo).
-- =============================================================================

begin;

-- ── 0) Envío idempotente: id de cliente para deduplicar el outbox ────────────
alter table sgc.mensajes add column if not exists client_msg_id text;
create unique index if not exists uq_mensajes_client
  on sgc.mensajes(conversacion_id, autor_id, client_msg_id)
  where client_msg_id is not null;

-- ── 1) listar_conversaciones(): tarjetas de chat (último msg + no leídos) ─────
create or replace function sgc.listar_conversaciones()
returns table (
  id uuid, tipo text, nombre text, ultimo_mensaje text, ultimo_at timestamptz,
  no_leidos integer, otro_usuario_id uuid
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with mis as (
    select cp.conversacion_id, cp.last_read_at
    from sgc.conversacion_participantes cp
    where cp.usuario_id = auth.uid()
  )
  select
    c.id,
    c.tipo,
    case when c.tipo = 'grupo' then c.nombre
         else (select u.nombre from sgc.conversacion_participantes cp2
               join sgc.usuarios u on u.id = cp2.usuario_id
               where cp2.conversacion_id = c.id and cp2.usuario_id <> auth.uid() limit 1)
    end as nombre,
    (select m.contenido from sgc.mensajes m where m.conversacion_id = c.id
       order by m.created_at desc limit 1) as ultimo_mensaje,
    (select m.created_at from sgc.mensajes m where m.conversacion_id = c.id
       order by m.created_at desc limit 1) as ultimo_at,
    (select count(*)::int from sgc.mensajes m
       where m.conversacion_id = c.id and m.autor_id <> auth.uid()
         and m.created_at > mis.last_read_at) as no_leidos,
    case when c.tipo <> 'grupo' then
      (select cp2.usuario_id from sgc.conversacion_participantes cp2
       where cp2.conversacion_id = c.id and cp2.usuario_id <> auth.uid() limit 1)
    end as otro_usuario_id
  from mis join sgc.conversaciones c on c.id = mis.conversacion_id
  order by ultimo_at desc nulls last;
$$;
grant execute on function sgc.listar_conversaciones() to authenticated, service_role;

-- ── 2) listar_mensajes(conv, before, limit): paginado hacia atrás ────────────
create or replace function sgc.listar_mensajes(
  p_conversacion_id uuid,
  p_before timestamptz default null,
  p_limit  int default 30
) returns table (
  id uuid, autor_id uuid, autor_nombre text, contenido text,
  archivo_path text, archivo_nombre text, archivo_mime text, created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select m.id, m.autor_id, u.nombre::text, m.contenido,
         m.archivo_path, m.archivo_nombre, m.archivo_mime, m.created_at
  from sgc.mensajes m
  join sgc.usuarios u on u.id = m.autor_id
  where m.conversacion_id = p_conversacion_id
    and sgc.es_participante(p_conversacion_id)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
grant execute on function sgc.listar_mensajes(uuid, timestamptz, int) to authenticated, service_role;

-- ── 3) enviar_mensaje(...): envío idempotente (outbox) + push a participantes ─
create or replace function sgc.enviar_mensaje(
  p_conversacion_id uuid,
  p_contenido       text default null,
  p_archivo_path    text default null,
  p_archivo_nombre  text default null,
  p_archivo_mime    text default null,
  p_client_id       text default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_autor text;
  v_conv sgc.conversaciones%rowtype;
  v_prev text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.es_participante(p_conversacion_id) then
    raise exception 'No perteneces a esta conversación.';
  end if;
  if nullif(trim(coalesce(p_contenido,'')),'') is null and nullif(trim(coalesce(p_archivo_path,'')),'') is null then
    raise exception 'El mensaje no puede estar vacío.';
  end if;

  -- Idempotencia por client_msg_id (reintentos del outbox no duplican).
  if p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  insert into sgc.mensajes (conversacion_id, autor_id, contenido, archivo_path, archivo_nombre, archivo_mime, client_msg_id)
  values (p_conversacion_id, v_uid, nullif(p_contenido,''), nullif(p_archivo_path,''),
          nullif(p_archivo_nombre,''), nullif(p_archivo_mime,''), p_client_id)
  on conflict (conversacion_id, autor_id, client_msg_id) where client_msg_id is not null
    do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    return v_id;
  end if;

  -- Marca leído para el autor (su propio envío no cuenta como no leído).
  update sgc.conversacion_participantes set last_read_at = now()
    where conversacion_id = p_conversacion_id and usuario_id = v_uid;

  -- Push AF7 a los demás participantes (deep-link). Sin fila en el bell: el badge
  -- de no-leídos ya cubre el in-app; evitamos inundar notificaciones.
  select nombre into v_autor from sgc.usuarios where id = v_uid;
  select * into v_conv from sgc.conversaciones where id = p_conversacion_id;
  v_prev := coalesce(nullif(trim(p_contenido),''), '📎 Archivo adjunto');
  perform sgc.send_push(
    array(select cp.usuario_id from sgc.conversacion_participantes cp
          where cp.conversacion_id = p_conversacion_id and cp.usuario_id <> v_uid),
    case when v_conv.tipo = 'grupo' then coalesce(v_conv.nombre,'Grupo')||' · '||coalesce(v_autor,'Mensaje')
         else coalesce(v_autor,'Nuevo mensaje') end,
    left(v_prev, 140),
    jsonb_build_object('tipo','mensaje','ruta','/mensajes/'||p_conversacion_id::text,
                       'conversacion_id', p_conversacion_id::text)
  );

  return v_id;
end;
$$;
grant execute on function sgc.enviar_mensaje(uuid, text, text, text, text, text) to authenticated, service_role;

-- ── 4) marcar_conversacion_leida(conv): avanza el cursor de lectura ──────────
create or replace function sgc.marcar_conversacion_leida(p_conversacion_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_participante(p_conversacion_id) then
    raise exception 'No perteneces a esta conversación.';
  end if;
  update sgc.conversacion_participantes set last_read_at = now()
    where conversacion_id = p_conversacion_id and usuario_id = auth.uid();
end;
$$;
grant execute on function sgc.marcar_conversacion_leida(uuid) to authenticated, service_role;

commit;
