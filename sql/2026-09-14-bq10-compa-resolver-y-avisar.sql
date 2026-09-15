-- BQ10 — Resolver backlog de Compa y avisar al que preguntó  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- El panel /tecnologia/consultas-compa ya marca resuelto, pero no agrupa preguntas
-- equivalentes ni avisa al usuario cuando su consulta ya se puede atender.  Aquí:
--   · columna resuelto_en_version (traza de qué versión lo resolvió)
--   · notif_tipo 'compa_capacidad_nueva' (informativa; respeta silencios)
--   · RPC resolver_consulta_compa: agrupa por pregunta normalizada / misma tool,
--     marca resuelto y NOTIFICA a cada usuario distinto con deep-link al chat.
-- Validar begin/rollback.  Aplicar con OK.
-- ---------------------------------------------------------------------------------

alter table sgc.assistant_consultas_no_atendidas
  add column if not exists resuelto_en_version text;

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('compa_capacidad_nueva', 'Compa ya puede ayudarte',
        'Una consulta que le hiciste a Compa y no pudo, ahora sí se puede.',
        false, array['in_app','push']::text[], true, 70)
on conflict (tipo) do nothing;

create or replace function sgc.resolver_consulta_compa(
  p_id uuid, p_tool text default null, p_nota text default null, p_version text default null
)
returns integer
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_preg_norm text;
  v_tool      text;
  v_n         integer := 0;
  r           record;
begin
  if not sgc.es_tecnologia() then
    raise exception 'Solo Tecnología puede resolver consultas de Compa' using errcode = '42501';
  end if;

  select lower(regexp_replace(pregunta, '\s+', ' ', 'g')), tool
    into v_preg_norm, v_tool
    from sgc.assistant_consultas_no_atendidas where id = p_id;
  if not found then raise exception 'Consulta no encontrada'; end if;

  -- Grupo: la misma pregunta normalizada, o la misma tool (si la había).
  update sgc.assistant_consultas_no_atendidas c
     set resuelto = true, resuelto_por = v_uid, resuelto_at = now(),
         resuelto_en_version = nullif(trim(p_version),''),
         tool = coalesce(nullif(trim(p_tool),''), c.tool),
         detalle = coalesce(nullif(trim(p_nota),''), c.detalle)
   where not c.resuelto
     and (
       lower(regexp_replace(c.pregunta, '\s+', ' ', 'g')) = v_preg_norm
       or (v_tool is not null and c.tool = v_tool)
     );
  get diagnostics v_n = row_count;

  -- Avisar a cada usuario distinto que preguntó (con su pregunta literal).
  for r in
    select distinct on (c.usuario_id) c.usuario_id, c.pregunta
      from sgc.assistant_consultas_no_atendidas c
     where c.resuelto_por = v_uid and c.resuelto_at >= now() - interval '5 seconds'
       and c.usuario_id is not null
     order by c.usuario_id, c.created_at desc
  loop
    perform sgc.notificar(
      r.usuario_id, 'compa_capacidad_nueva', 'Compa ya puede ayudarte con esto',
      r.pregunta,
      '/asistente?q=' || replace(replace(r.pregunta, E'\n', ' '), '  ', ' ')
    );
  end loop;

  return v_n;
end;
$function$;
grant execute on function sgc.resolver_consulta_compa(uuid,text,text,text) to authenticated;
