-- =============================================================================
-- PROMPT-8 (app) follow-up a AN6 — Ronda 11/08/2026. SGC padre.
-- La migración AN6 (grupos tipo WhatsApp) agregó `mensajes.tipo` ('texto'|'sistema')
-- e inserta eventos de sistema ("X agregó a Y") con grupo_evento(), PERO el lector
-- `listar_mensajes` NO devolvía la columna → la app (y la web) no podían distinguir
-- un evento de sistema de un mensaje normal. Aditivo y retrocompatible: se agrega
-- `tipo` a la salida (los consumidores que leen por nombre no se afectan; coalesce
-- a 'texto' para filas viejas).
-- =============================================================================

begin;

-- El tipo de retorno cambia (columna nueva) → hay que DROP + CREATE.
drop function if exists sgc.listar_mensajes(uuid, timestamptz, integer);

create function sgc.listar_mensajes(
  p_conversacion_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (
  id uuid, autor_id uuid, autor_nombre text, contenido text, tipo text,
  archivo_path text, archivo_nombre text, archivo_mime text, created_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select m.id, m.autor_id, u.nombre::text, m.contenido, coalesce(m.tipo, 'texto'),
         m.archivo_path, m.archivo_nombre, m.archivo_mime, m.created_at
  from sgc.mensajes m
  join sgc.usuarios u on u.id = m.autor_id
  where m.conversacion_id = p_conversacion_id
    and sgc.es_participante(p_conversacion_id)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- Restaurar los grants (el DROP los borró; el original era PUBLIC/authenticated).
grant execute on function sgc.listar_mensajes(uuid, timestamptz, integer) to public;

comment on function sgc.listar_mensajes(uuid, timestamptz, integer) is
  'AN6b — lista mensajes de una conversación (participantes). Incluye `tipo` (texto|sistema) para pintar los eventos de grupo distinto a los mensajes.';

commit;
