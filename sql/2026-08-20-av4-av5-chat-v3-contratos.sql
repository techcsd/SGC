-- ════════════════════════════════════════════════════════════════════════════
-- AV4/AV5 — Chat nivel WhatsApp v3: contratos (receipts, notas de voz, stickers)
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo/retrocompatible sobre la mensajería (AJ5/AN6) y los stickers (AT16).
--
-- (AV5) Receipts por mensaje SIN fila-por-mensaje: modelo de CURSORES por
--   participante (escala mejor y reusa last_read_at). Un mensaje está:
--     • enviado  → existe en el server (created_at).
--     • recibido → last_delivered_at del destinatario >= created_at del mensaje.
--     • leído    → last_read_at    del destinatario >= created_at del mensaje.
--   En grupos, ✓✓ azul (leído) cuando TODOS los demás lo leyeron (asunción AV5).
--
-- (AV5) Notas de voz: mensaje tipo 'audio' + duracion_seg, en el bucket sgc-mensajes;
--   compatible con el outbox (client_msg_id). Waveform la calcula el cliente.
--
-- (AV5) Presencia/typing: canal Realtime EFÍMERO por conversación (broadcast),
--   NO requiere tablas. Contrato documentado abajo para web y app.
--
-- (AV4) Stickers v3: renombrar/mover packs y "guardar sticker de otro". El editor
--   previo (recorte + bordes redondeados) es del cliente; el upload ya acepta la
--   imagen final (webp/png con alpha) vía agregar_sticker (AT16).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- AV5 · RECEIPTS (cursores)
-- ────────────────────────────────────────────────────────────────────────────
alter table sgc.conversacion_participantes
  add column if not exists last_delivered_at timestamptz;
comment on column sgc.conversacion_participantes.last_delivered_at is
  'AV5 — cursor "recibido en el dispositivo": mensajes con created_at <= este valor están entregados a este usuario (✓✓).';

-- El dispositivo marca "recibido hasta ahora" al recibir mensajes (realtime/foreground).
create or replace function sgc.marcar_conversacion_entregada(p_conversacion_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.es_participante(p_conversacion_id) then raise exception 'No perteneces a esta conversación.'; end if;
  update sgc.conversacion_participantes
     set last_delivered_at = greatest(coalesce(last_delivered_at, to_timestamp(0)), now())
   where conversacion_id = p_conversacion_id and usuario_id = auth.uid();
end;
$$;
grant execute on function sgc.marcar_conversacion_entregada(uuid) to authenticated, service_role;

-- Cursores de los DEMÁS participantes → el cliente pinta ✓/✓✓/✓✓azul por mensaje.
create or replace function sgc.conversacion_recibos(p_conversacion_id uuid)
returns table (
  usuario_id        uuid,
  nombre            text,
  last_read_at      timestamptz,
  last_delivered_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select cp.usuario_id, u.nombre::text, cp.last_read_at, cp.last_delivered_at
  from sgc.conversacion_participantes cp
  join sgc.usuarios u on u.id = cp.usuario_id
  where cp.conversacion_id = p_conversacion_id
    and sgc.es_participante(p_conversacion_id)
    and cp.usuario_id <> auth.uid();
$$;
grant execute on function sgc.conversacion_recibos(uuid) to authenticated, service_role;

-- Detalle de recibos de UN mensaje (regla AT11: toda data visualizable en la web).
create or replace function sgc.estado_mensaje(p_mensaje_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_conv uuid; v_created timestamptz; v_autor uuid; v_total int;
begin
  select conversacion_id, created_at, autor_id into v_conv, v_created, v_autor
    from sgc.mensajes where id = p_mensaje_id;
  if v_conv is null then return null; end if;
  if not sgc.es_participante(v_conv) then raise exception 'No autorizado'; end if;

  select count(*) into v_total from sgc.conversacion_participantes
    where conversacion_id = v_conv and usuario_id <> v_autor;

  return jsonb_build_object(
    'mensaje_id', p_mensaje_id,
    'enviado_at', v_created,
    'entregado_por', (
      select coalesce(jsonb_agg(jsonb_build_object('nombre', u.nombre, 'at', cp.last_delivered_at) order by cp.last_delivered_at), '[]'::jsonb)
      from sgc.conversacion_participantes cp join sgc.usuarios u on u.id = cp.usuario_id
      where cp.conversacion_id = v_conv and cp.usuario_id <> v_autor
        and cp.last_delivered_at is not null and cp.last_delivered_at >= v_created),
    'leido_por', (
      select coalesce(jsonb_agg(jsonb_build_object('nombre', u.nombre, 'at', cp.last_read_at) order by cp.last_read_at), '[]'::jsonb)
      from sgc.conversacion_participantes cp join sgc.usuarios u on u.id = cp.usuario_id
      where cp.conversacion_id = v_conv and cp.usuario_id <> v_autor
        and cp.last_read_at is not null and cp.last_read_at >= v_created),
    'entregado_todos', (
      select count(*) = v_total from sgc.conversacion_participantes cp
      where cp.conversacion_id = v_conv and cp.usuario_id <> v_autor
        and cp.last_delivered_at is not null and cp.last_delivered_at >= v_created),
    'leido_todos', (
      select count(*) = v_total from sgc.conversacion_participantes cp
      where cp.conversacion_id = v_conv and cp.usuario_id <> v_autor
        and cp.last_read_at is not null and cp.last_read_at >= v_created)
  );
end;
$$;
grant execute on function sgc.estado_mensaje(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- AV5 · NOTAS DE VOZ (mensaje tipo 'audio')
-- ────────────────────────────────────────────────────────────────────────────
alter table sgc.mensajes drop constraint if exists mensajes_tipo_check;
alter table sgc.mensajes add constraint mensajes_tipo_check
  check (tipo in ('texto','sistema','sticker','audio'));
alter table sgc.mensajes add column if not exists duracion_seg int;
comment on column sgc.mensajes.duracion_seg is 'AV5 — duración (segundos) de la nota de voz (tipo=audio).';

create or replace function sgc.enviar_nota_voz(
  p_conversacion_id uuid, p_archivo_path text, p_duracion_seg int,
  p_archivo_mime text default 'audio/webm', p_client_id text default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v_autor text; v_conv sgc.conversaciones%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.es_participante(p_conversacion_id) then raise exception 'No perteneces a esta conversación.'; end if;
  if nullif(trim(coalesce(p_archivo_path,'')),'') is null then raise exception 'Falta el audio.'; end if;

  if p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  insert into sgc.mensajes (conversacion_id, autor_id, tipo, archivo_path, archivo_mime, duracion_seg, client_msg_id)
  values (p_conversacion_id, v_uid, 'audio', p_archivo_path, coalesce(p_archivo_mime,'audio/webm'), greatest(0, coalesce(p_duracion_seg,0)), p_client_id)
  on conflict (conversacion_id, autor_id, client_msg_id) where client_msg_id is not null do nothing
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
  perform sgc.send_push(
    array(select cp.usuario_id from sgc.conversacion_participantes cp
          where cp.conversacion_id = p_conversacion_id and cp.usuario_id <> v_uid),
    case when v_conv.tipo = 'grupo' then coalesce(v_conv.nombre,'Grupo')||' · '||coalesce(v_autor,'Mensaje')
         else coalesce(v_autor,'Nuevo mensaje') end,
    '🎤 Nota de voz',
    jsonb_build_object('tipo','mensaje','ruta','/mensajes/'||p_conversacion_id::text,
                       'conversacion_id', p_conversacion_id::text)
  );
  return v_id;
end;
$$;
grant execute on function sgc.enviar_nota_voz(uuid, text, int, text, text) to authenticated, service_role;

-- listar_mensajes: agrega duracion_seg (para pintar el player de voz en la app).
drop function if exists sgc.listar_mensajes(uuid, timestamptz, integer);
create or replace function sgc.listar_mensajes(p_conversacion_id uuid, p_before timestamptz default null, p_limit integer default 30)
returns table(id uuid, autor_id uuid, autor_nombre text, contenido text, tipo text,
              archivo_path text, archivo_nombre text, archivo_mime text, duracion_seg int, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select m.id, m.autor_id, u.nombre::text, m.contenido, coalesce(m.tipo, 'texto'),
         m.archivo_path, m.archivo_nombre, m.archivo_mime, m.duracion_seg, m.created_at
  from sgc.mensajes m
  join sgc.usuarios u on u.id = m.autor_id
  where m.conversacion_id = p_conversacion_id
    and sgc.es_participante(p_conversacion_id)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$function$;
grant execute on function sgc.listar_mensajes(uuid, timestamptz, integer) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- AV4 · STICKERS v3 (renombrar/mover packs, guardar de otros, enviar por RPC)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function sgc.renombrar_pack_sticker(p_pack_id uuid, p_nombre text)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'El pack necesita un nombre.'; end if;
  update sgc.sticker_packs set nombre = trim(p_nombre)
    where id = p_pack_id and usuario_id = auth.uid() and not es_sistema;
  if not found then raise exception 'No puedes renombrar este pack.'; end if;
end;
$$;
grant execute on function sgc.renombrar_pack_sticker(uuid, text) to authenticated, service_role;

create or replace function sgc.mover_sticker(p_sticker_id uuid, p_pack_id uuid)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  -- el sticker y el pack destino deben ser del usuario (no del sistema)
  if not exists (select 1 from sgc.sticker_packs p where p.id = p_pack_id and p.usuario_id = auth.uid() and not p.es_sistema) then
    raise exception 'Pack destino inválido.';
  end if;
  update sgc.stickers s set pack_id = p_pack_id
    where s.id = p_sticker_id
      and exists (select 1 from sgc.sticker_packs p2 where p2.id = s.pack_id and p2.usuario_id = auth.uid());
  if not found then raise exception 'No puedes mover este sticker.'; end if;
end;
$$;
grant execute on function sgc.mover_sticker(uuid, uuid) to authenticated, service_role;

-- Guardar un sticker recibido (de otro) → a mis stickers (pack dado o "Guardados").
create or replace function sgc.guardar_sticker(p_ref text, p_pack_id uuid default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_pack uuid := p_pack_id;
  v_id uuid;
  v_es_asset boolean := p_ref like 'assets/%';
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_ref,'')),'') is null then raise exception 'Sticker inválido.'; end if;

  -- pack destino: el dado (si es mío) o mi pack "Guardados" (se crea si no existe)
  if v_pack is not null then
    if not exists (select 1 from sgc.sticker_packs where id = v_pack and usuario_id = v_uid and not es_sistema) then
      v_pack := null;
    end if;
  end if;
  if v_pack is null then
    select id into v_pack from sgc.sticker_packs where usuario_id = v_uid and nombre = 'Guardados' limit 1;
    if v_pack is null then
      insert into sgc.sticker_packs (nombre, es_sistema, usuario_id, orden)
      values ('Guardados', false, v_uid, 50) returning id into v_pack;
    end if;
  end if;

  -- ya guardado antes → devolver el existente (idempotente)
  select s.id into v_id from sgc.stickers s
    join sgc.sticker_packs p on p.id = s.pack_id
   where p.usuario_id = v_uid
     and coalesce(s.asset_path, s.storage_path) = p_ref
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into sgc.stickers (pack_id, asset_path, storage_path, orden)
  values (v_pack,
          case when v_es_asset then p_ref else null end,
          case when v_es_asset then null else p_ref end,
          coalesce((select max(orden)+1 from sgc.stickers where pack_id = v_pack), 0))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.guardar_sticker(text, uuid) to authenticated, service_role;

-- Enviar sticker por RPC (paridad app + idempotencia de outbox). La web puede
-- seguir insertando directo; este contrato lo consume la app.
create or replace function sgc.enviar_sticker(p_conversacion_id uuid, p_ref text, p_client_id text default null)
returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_autor text; v_conv sgc.conversaciones%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.es_participante(p_conversacion_id) then raise exception 'No perteneces a esta conversación.'; end if;
  if nullif(trim(coalesce(p_ref,'')),'') is null then raise exception 'Sticker inválido.'; end if;

  if p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  insert into sgc.mensajes (conversacion_id, autor_id, tipo, archivo_path, archivo_mime, client_msg_id)
  values (p_conversacion_id, v_uid, 'sticker', p_ref, 'image/sticker', p_client_id)
  on conflict (conversacion_id, autor_id, client_msg_id) where client_msg_id is not null do nothing
  returning id into v_id;
  if v_id is null and p_client_id is not null then
    select id into v_id from sgc.mensajes
      where conversacion_id = p_conversacion_id and autor_id = v_uid and client_msg_id = p_client_id;
    return v_id;
  end if;

  perform sgc.registrar_sticker_reciente(p_ref);
  update sgc.conversacion_participantes set last_read_at = now()
    where conversacion_id = p_conversacion_id and usuario_id = v_uid;

  select nombre into v_autor from sgc.usuarios where id = v_uid;
  select * into v_conv from sgc.conversaciones where id = p_conversacion_id;
  perform sgc.send_push(
    array(select cp.usuario_id from sgc.conversacion_participantes cp
          where cp.conversacion_id = p_conversacion_id and cp.usuario_id <> v_uid),
    case when v_conv.tipo = 'grupo' then coalesce(v_conv.nombre,'Grupo')||' · '||coalesce(v_autor,'Mensaje')
         else coalesce(v_autor,'Nuevo mensaje') end,
    '💟 Sticker',
    jsonb_build_object('tipo','mensaje','ruta','/mensajes/'||p_conversacion_id::text,
                       'conversacion_id', p_conversacion_id::text)
  );
  return v_id;
end;
$$;
grant execute on function sgc.enviar_sticker(uuid, text, text) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AV5 · PRESENCIA / TYPING (contrato Realtime, sin tablas)
-- ════════════════════════════════════════════════════════════════════════════
-- Canal efímero por conversación: nombre  'chat:presencia:{conversacion_id}'.
-- Broadcast event 'estado' con payload { usuario_id, nombre, accion, at }, donde
--   accion ∈ 'escribiendo' | 'grabando' | 'sticker' | 'nada'.
-- El emisor manda 'escribiendo'/'grabando'/'sticker' mientras actúa y 'nada' al
-- parar; el receptor auto-expira el indicador a los ~5 s sin refresco. Web y app
-- usan el MISMO nombre de canal y payload. No persiste (no toca la BD).
