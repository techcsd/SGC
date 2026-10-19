-- ============================================================================
-- CR1 — FASE 6: Admin › Claude (mock Admin-claude) — 4 contadores + "lo que
-- hizo Claude" (últimas llamadas, todas las personas). Admin-only.
-- ============================================================================
begin;

create or replace function sgc.claude_admin_resumen()
 returns jsonb
 language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'personas_conectadas', (select count(distinct usuario_id) from sgc.claude_llamadas),
    'consultas_7d', (select count(*) from sgc.claude_llamadas where creado_en > now() - interval '7 days'),
    'borradores_preparados', (select count(*) from sgc.claude_borradores),
    'borradores_confirmados', (select count(*) from sgc.claude_borradores where estado = 'confirmado'),
    'con_error_7d', (select count(*) from sgc.claude_llamadas where not ok and creado_en > now() - interval '7 days')
  );
end;
$function$;
grant execute on function sgc.claude_admin_resumen() to authenticated;

create or replace function sgc.claude_llamadas_recientes(p_limite integer default 20)
 returns table(hora timestamptz, nombre text, herramienta text, ok boolean, error text)
 language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select l.creado_en, u.nombre::text, l.herramienta, l.ok, l.error
      from sgc.claude_llamadas l
      join sgc.usuarios u on u.id = l.usuario_id
     order by l.creado_en desc
     limit least(coalesce(p_limite, 20), 100);
end;
$function$;
grant execute on function sgc.claude_llamadas_recientes(integer) to authenticated;

commit;
