-- ============================================================================
-- CR1 — FASE 6: Perfil › Claude necesita "mi" estado de conexión (no todas —
-- eso ya lo tiene claude_conexiones_listado, admin-only). RPC propia, misma
-- forma, security invoker (la RLS de claude_llamadas/claude_borradores ya
-- limita a "lo mío").
-- ============================================================================
begin;

create or replace function sgc.claude_mi_conexion()
 returns jsonb
 language sql stable security invoker set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
    'conectado', exists(select 1 from sgc.claude_llamadas where usuario_id = auth.uid()),
    'desde', (select min(creado_en) from sgc.claude_llamadas where usuario_id = auth.uid()),
    'ultima_actividad', (select max(creado_en) from sgc.claude_llamadas where usuario_id = auth.uid()),
    'consultas_7d', (select count(*) from sgc.claude_llamadas where usuario_id = auth.uid() and creado_en > now() - interval '7 days'),
    'borradores_pendientes', (select count(*) from sgc.claude_borradores where usuario_id = auth.uid() and estado = 'pendiente' and expira_en > now())
  );
$function$;
grant execute on function sgc.claude_mi_conexion() to authenticated;

commit;
