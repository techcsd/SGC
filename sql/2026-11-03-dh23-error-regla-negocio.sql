-- DH23 — rechazos esperados (fecha pasada, lectura menor, conduce no despachado,
-- sin existencia…) no son bugs: son la regla de negocio funcionando. Hoy el panel
-- de "Reportes de errores" solo distingue abierto/en_revision/solucionado, así que
-- Tecnología tenía que marcar estas firmas "solucionado" (mintiendo sobre qué pasó)
-- para sacarlas de la bandeja de abiertos. Nuevo estado `regla_negocio`: se cuenta
-- aparte, no abre como pendiente, y queda claro que no requiere código.

begin;

alter table sgc.app_error_estados drop constraint app_error_estados_estado_check;
alter table sgc.app_error_estados add constraint app_error_estados_estado_check
  check (estado = any (array['abierto','en_revision','solucionado','regla_negocio']));

create or replace function sgc.marcar_error_estado(p_firma text, p_estado text, p_nota text DEFAULT NULL::text, p_resuelto_en_version text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso para atender reportes de errores' using errcode = '42501';
  end if;
  if coalesce(trim(p_firma),'') = '' then raise exception 'firma requerida' using errcode = '22023'; end if;
  if p_estado not in ('abierto','en_revision','solucionado','regla_negocio') then raise exception 'estado inválido' using errcode = '22023'; end if;

  insert into sgc.app_error_estados (firma, estado, nota, resuelto_por, resuelto_at, resuelto_en_version, updated_at)
  values (
    p_firma, p_estado, nullif(trim(p_nota),''),
    case when p_estado = 'solucionado' then v_uid else null end,
    case when p_estado = 'solucionado' then now() else null end,
    case when p_estado = 'solucionado' then nullif(trim(p_resuelto_en_version),'') else null end,
    now())
  on conflict (firma) do update set
    estado = excluded.estado,
    nota = coalesce(excluded.nota, sgc.app_error_estados.nota),
    resuelto_por = case when p_estado = 'solucionado' then v_uid else null end,
    resuelto_at  = case when p_estado = 'solucionado' then now() else null end,
    resuelto_en_version = case when p_estado = 'solucionado'
                               then coalesce(nullif(trim(p_resuelto_en_version),''), sgc.app_error_estados.resuelto_en_version)
                               else null end,
    reabierto_at = case when p_estado = 'solucionado' then sgc.app_error_estados.reabierto_at else null end,
    ocurrencias_cliente_viejo = case when p_estado = 'solucionado' then sgc.app_error_estados.ocurrencias_cliente_viejo else 0 end,
    updated_at = now();
end;
$function$;

-- 'abiertos' ahora excluye solucionado Y regla_negocio (ninguno de los 2 necesita atención).
create or replace function sgc.app_error_reports_grupos(p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_error_type text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_source text DEFAULT NULL::text, p_estado text DEFAULT NULL::text)
 RETURNS TABLE(firma text, error_type text, source text, ocurrencias bigint, dispositivos bigint, usuarios bigint, primera_vez timestamp with time zone, ultima_vez timestamp with time zone, ejemplo_message text, ejemplo_id uuid, estado text, nota text, resuelto_por_nombre text, resuelto_at timestamp with time zone, reabierto_at timestamp with time zone, resuelto_en_version text, ocurrencias_cliente_viejo integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
  with g as (
    select sgc.error_firma(r.message) as firma,
      (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
      (array_agg(r.source order by r.created_at desc))[1] as source,
      count(*) as ocurrencias,
      count(distinct coalesce(r.device_model,'?')) as dispositivos,
      count(distinct r.user_id) as usuarios,
      min(r.created_at) as primera_vez, max(r.created_at) as ultima_vez,
      (array_agg(r.message order by r.created_at desc))[1] as ejemplo_message,
      (array_agg(r.id order by r.created_at desc))[1] as ejemplo_id
    from sgc.app_error_reports r
    where sgc.es_tecnologia()
      and (p_desde is null or r.created_at >= p_desde)
      and (p_hasta is null or r.created_at <= p_hasta)
      and (p_error_type is null or r.error_type = p_error_type)
      and (p_source is null or r.source = p_source)
    group by sgc.error_firma(r.message)
  )
  select g.firma, g.error_type, g.source, g.ocurrencias, g.dispositivos, g.usuarios,
    g.primera_vez, g.ultima_vez, g.ejemplo_message, g.ejemplo_id,
    coalesce(e.estado, 'abierto') as estado, e.nota,
    u.nombre as resuelto_por_nombre, e.resuelto_at, e.reabierto_at,
    e.resuelto_en_version, coalesce(e.ocurrencias_cliente_viejo, 0)
  from g
  left join sgc.app_error_estados e on e.firma = g.firma
  left join sgc.usuarios u on u.id = e.resuelto_por
  where (p_estado is null
         or (p_estado = 'solucionado' and coalesce(e.estado,'abierto') = 'solucionado')
         or (p_estado = 'abiertos'    and coalesce(e.estado,'abierto') not in ('solucionado','regla_negocio'))
         or (p_estado = coalesce(e.estado,'abierto')))
  order by g.ocurrencias desc, g.ultima_vez desc
  limit greatest(1, least(coalesce(p_limit,100), 5000));
$function$;

commit;
