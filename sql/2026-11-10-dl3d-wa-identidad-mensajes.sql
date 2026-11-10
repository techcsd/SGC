-- =============================================================================
-- DL-07 (continuación de dl3) — identidad SGC en la búsqueda del Archivo:
-- además del apodo de WhatsApp, devuelve a qué usuario SGC corresponde el
-- teléfono (si está en sgc.whatsapp_autorizados), para que la pantalla
-- muestre "Apodo (Nombre SGC)".
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl3d-wa-identidad-mensajes.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

create or replace function sgc.wa_mensajes_grupo_buscar_v2(
  p_consulta text, p_grupo_jid text default null, p_desde timestamptz default null,
  p_hasta timestamptz default null, p_limite integer default 20
) returns table (
  id uuid, grupo_jid text, grupo_nombre text, autor_nombre text, autor_telefono text,
  autor_usuario_id uuid, autor_usuario_nombre text,
  tipo text, fragmento text, enviado_en timestamptz
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select m.id, m.grupo_jid, g.nombre, m.autor_nombre, m.autor_telefono,
    sgc.wa_autor_usuario(m.autor_telefono),
    (select u.nombre from sgc.usuarios u where u.id = sgc.wa_autor_usuario(m.autor_telefono)),
    m.tipo,
    ts_headline('spanish',
      coalesce(m.texto,'') || ' ' || coalesce(m.transcripcion,'') || ' ' || coalesce(m.descripcion_media,''),
      websearch_to_tsquery('spanish', coalesce(p_consulta,'')),
      'StartSel=**,StopSel=**,MaxFragments=1,MaxWords=40,MinWords=10'
    ) as fragmento,
    m.enviado_en
  from sgc.wa_mensajes_grupo m
  join sgc.wa_grupos g on g.jid = m.grupo_jid
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and (p_grupo_jid is null or m.grupo_jid = p_grupo_jid)
    and (p_desde is null or m.enviado_en >= p_desde)
    and (p_hasta is null or m.enviado_en <= p_hasta)
    and to_tsvector('spanish', coalesce(m.texto,'') || ' ' || coalesce(m.transcripcion,'') || ' ' || coalesce(m.descripcion_media,''))
        @@ websearch_to_tsquery('spanish', coalesce(p_consulta,''))
  order by m.enviado_en desc
  limit greatest(1, least(coalesce(p_limite,20), 100));
$$;
grant execute on function sgc.wa_mensajes_grupo_buscar_v2(text,text,timestamptz,timestamptz,integer) to authenticated, service_role;

commit;
