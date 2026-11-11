-- ============================================================================
-- DM4 (ronda DM, PROMPT 140 F4) — Conector fase 2, DETRÁS DE UN APAGADOR
-- (`claude_skills_conector`, apagado por defecto): herramientas de SOLO
-- LECTURA `mis_skills_claude` y `leer_skill_claude(slug)` para el MCP.
--
-- Alcance V1 (simplificación honesta, reportada): `leer_skill_claude` lee de
-- una columna `contenido_texto` poblada por claude-skill-validar SOLO para
-- archivos .md/.txt sueltos (no .zip) — leer el contenido de un .zip desde SQL
-- puro requeriría acceso a Storage, que esta RPC no tiene. Para una skill en
-- .zip, el tool responde que se descargue desde el módulo Claude. Encenderlo
-- (poner el parámetro en 'true') es decisión de Xaviel, después de la auditoría.
-- ============================================================================
begin;

alter table sgc.claude_skill_versiones add column if not exists contenido_texto text;
comment on column sgc.claude_skill_versiones.contenido_texto is
  'DM4 — texto plano del archivo, SOLO para .md/.txt (null para .zip). Lo usa leer_skill_claude cuando se encienda el conector.';

insert into sgc.parametros (clave, valor, descripcion) values
  ('claude_skills_conector', 'false', 'DM4 — apagador del conector fase 2 (mis_skills_claude/leer_skill_claude). Apagado hasta que Xaviel lo encienda tras la auditoría N1c.')
on conflict (clave) do nothing;

create or replace function sgc.mis_skills_claude()
returns table(slug text, nombre text, descripcion text, tipo text, ambito text, estado text)
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if coalesce((select valor from sgc.parametros where clave = 'claude_skills_conector'), 'false') <> 'true' then
    raise exception 'El conector de skills de Claude está apagado todavía.' using errcode = '42501';
  end if;
  return query
    select s.slug, s.nombre, s.descripcion, s.tipo, s.ambito, s.estado
      from sgc.claude_skills s
     order by s.updated_at desc;
end;
$function$;
grant execute on function sgc.mis_skills_claude() to authenticated;

create or replace function sgc.leer_skill_claude(p_slug text)
returns text
language plpgsql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_skill_id uuid;
  v_version  int;
  v_texto    text;
  v_es_zip   boolean;
begin
  if coalesce((select valor from sgc.parametros where clave = 'claude_skills_conector'), 'false') <> 'true' then
    raise exception 'El conector de skills de Claude está apagado todavía.' using errcode = '42501';
  end if;
  select s.id, s.version_actual into v_skill_id, v_version from sgc.claude_skills s where s.slug = p_slug;
  if v_skill_id is null then
    raise exception 'No existe (o no puedes ver) una skill con ese slug.' using errcode = 'P0002';
  end if;
  select v.contenido_texto, v.storage_path like '%.zip' into v_texto, v_es_zip
    from sgc.claude_skill_versiones v where v.skill_id = v_skill_id and v.version = v_version;
  if v_es_zip then
    return 'Esta skill es un paquete (.zip) — descárgala desde el módulo Claude (pestaña Skills) para verla completa.';
  end if;
  if v_texto is null or char_length(v_texto) = 0 then
    return 'Esta skill no tiene texto guardado todavía.';
  end if;
  -- Límite de tamaño (DM-14): no se devuelven archivos binarios ni textos enormes.
  return left(v_texto, 20000);
end;
$function$;
grant execute on function sgc.leer_skill_claude(text) to authenticated;

commit;
