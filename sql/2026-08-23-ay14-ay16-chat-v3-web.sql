-- ════════════════════════════════════════════════════════════════════════════
-- AY14/AY16 — Chat v3 (soporte web): tamaño de adjunto para las cards de documento
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo/retrocompatible. El grueso de chat v3 (receipts por cursor, notas de voz
-- con duracion_seg, presencia/typing por broadcast, stickers v3) YA vive en
-- 2026-08-20-av4-av5-chat-v3-contratos.sql. Aquí solo falta el metadato de TAMAÑO
-- del adjunto para pintar las "cards ricas" de documentos (Word/Excel/PPT/PDF) con
-- ícono + nombre + tamaño + Abrir/Descargar (AY14, regla AT11).
--
-- La web inserta el mensaje directo (this.supabase.from('mensajes').insert), así que
-- con la columna basta. Se actualiza además el contrato enviar_mensaje/listar_mensajes
-- para que la app (PROMPT-30) mande y lea el tamaño con paridad.
-- ════════════════════════════════════════════════════════════════════════════

alter table sgc.mensajes add column if not exists archivo_size bigint;
comment on column sgc.mensajes.archivo_size is
  'AY14 — tamaño en bytes del adjunto (para la card de documento). null si no aplica.';

-- ── enviar_mensaje: acepta p_archivo_size (retrocompat: default null) ─────────
-- Se recrea la firma (6→7 args). Las llamadas con 6 args positionales resuelven la
-- nueva firma vía el default; las llamadas con parámetros nombrados siguen igual.
drop function if exists sgc.enviar_mensaje(uuid, text, text, text, text, text);
create or replace function sgc.enviar_mensaje(
  p_conversacion_id uuid,
  p_contenido       text default null,
  p_archivo_path    text default null,
  p_archivo_nombre  text default null,
  p_archivo_mime    text default null,
  p_client_id       text default null,
  p_archivo_size    bigint default null
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

  insert into sgc.mensajes (conversacion_id, autor_id, contenido, archivo_path, archivo_nombre, archivo_mime, archivo_size, client_msg_id)
  values (p_conversacion_id, v_uid, nullif(p_contenido,''), nullif(p_archivo_path,''),
          nullif(p_archivo_nombre,''), nullif(p_archivo_mime,''), p_archivo_size, p_client_id)
  on conflict (conversacion_id, autor_id, client_msg_id) where client_msg_id is not null
    do nothing
  returning id into v_id;

  if v_id is null and p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    return v_id;
  end if;

  update sgc.conversacion_participantes set last_read_at = now()
    where conversacion_id = p_conversacion_id and usuario_id = v_uid;

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
grant execute on function sgc.enviar_mensaje(uuid, text, text, text, text, text, bigint) to authenticated, service_role;

-- ── listar_mensajes: agrega archivo_size (para la card de documento en la app) ──
drop function if exists sgc.listar_mensajes(uuid, timestamptz, integer);
create or replace function sgc.listar_mensajes(p_conversacion_id uuid, p_before timestamptz default null, p_limit integer default 30)
returns table(id uuid, autor_id uuid, autor_nombre text, contenido text, tipo text,
              archivo_path text, archivo_nombre text, archivo_mime text, archivo_size bigint,
              duracion_seg int, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select m.id, m.autor_id, u.nombre::text, m.contenido, coalesce(m.tipo, 'texto'),
         m.archivo_path, m.archivo_nombre, m.archivo_mime, m.archivo_size, m.duracion_seg, m.created_at
  from sgc.mensajes m
  join sgc.usuarios u on u.id = m.autor_id
  where m.conversacion_id = p_conversacion_id
    and sgc.es_participante(p_conversacion_id)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$function$;
grant execute on function sgc.listar_mensajes(uuid, timestamptz, integer) to authenticated, service_role;
