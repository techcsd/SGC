-- CP6 — "Por despachar" (app) no muestra fecha ni código: la tarjeta
-- (csd-app/src/app/pages/transporte/despachos/despachos.html:15-21) solo pinta
-- obra, renglones y solicitante. El servidor ya tenía `fecha`/`created_at`;
-- le faltaban `codigo`, `urgencia` y `fecha_necesidad`. Aditivo — se agregan
-- columnas al final del `returns table` (regla 19, cambia la firma pero ningún
-- consumidor hace `select *` posicional contra esta función: tanto el app como
-- cualquier futuro consumidor web nombran columnas).
drop function if exists sgc.requisiciones_por_despachar();
create or replace function sgc.requisiciones_por_despachar()
returns table(
  id uuid, proyecto_id uuid, proyecto_nombre text, solicitante text,
  fecha date, renglones bigint, created_at timestamptz,
  codigo text, urgencia text, fecha_necesidad date
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sm.id, sm.proyecto_id, p.nombre::text, u.nombre::text, sm.created_at::date,
         (select count(*) from sgc.solicitud_material_items i
           where i.solicitud_id = sm.id and coalesce(i.estado,'pendiente') <> 'cancelada'),
         sm.created_at,
         case when sm.folio is not null then 'REQ-' || lpad(sm.folio::text, 6, '0') else null end,
         sm.urgencia, sm.fecha_necesidad
  from sgc.solicitudes_material sm
  left join sgc.proyectos p on p.id = sm.proyecto_id
  left join sgc.usuarios u on u.id = sm.solicitante_id
  where sm.estado in ('por_despachar', 'parcial')       -- BJ4 — el restante sigue alcanzable
    and sgc.puede_crear_conduce()
    and (sgc.usuario_actual_es_prueba() or sgc.is_admin()
         or not exists (select 1 from sgc.proyectos pp
                        where pp.id = sm.proyecto_id and coalesce(pp.es_prueba, false)))
  order by sm.created_at asc;      -- CP6: más viejas primero (antes: desc)
$$;
grant execute on function sgc.requisiciones_por_despachar() to authenticated;
