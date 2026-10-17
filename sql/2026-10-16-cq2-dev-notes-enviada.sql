-- ============================================================================
-- CQ2 — Dev notes: "Mandar a ronda" (16/10/2026)
-- ----------------------------------------------------------------------------
-- Columna aditiva para marcar cuándo una nota (cualquier ámbito, reutilizable
-- por /notas también) se copió al portapapeles para pegarla en una conversación
-- de ronda. Puramente informativo (no afecta RLS ni el storage de `contenido`,
-- que sigue siendo Markdown plano). RPC propio en vez de ampliar `guardar_nota`
-- para no acoplar un flag de "evento" al payload de guardado normal.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.notas add column if not exists enviada_a_ronda_at timestamptz;

create or replace function sgc.nota_marcar_enviada_ronda(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_editar_nota(p_id) then
    raise exception 'No tienes permiso para editar esta nota';
  end if;

  update sgc.notas set enviada_a_ronda_at = now() where id = p_id;

  return jsonb_build_object('enviada_a_ronda_at',
    (select enviada_a_ronda_at from sgc.notas where id = p_id));
end;
$function$;

grant execute on function sgc.nota_marcar_enviada_ronda(uuid) to authenticated;

commit;
