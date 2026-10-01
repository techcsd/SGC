-- CE1/CE4 — listar_personal_obra enriquecido para los contadores útiles al ingeniero
-- ---------------------------------------------------------------------------------
-- Añade tiene_contrato (hay al menos una firma) y tiene_foto_persona (la foto de la
-- persona existe) para pintar "Sin carnet / Sin asegurar / Sin contrato / Falta foto"
-- sin más viajes a la base. Mismo predicado de visibilidad (CE2).
-- ---------------------------------------------------------------------------------

create or replace function sgc.listar_personal_obra(p_proyecto uuid default null)
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(
    to_jsonb(po)
    || jsonb_build_object(
         'cargo', (select jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nombre', c.nombre)
                     from sgc.cargos c where c.id = po.cargo_id),
         'proyecto', (select jsonb_build_object('nombre', p.nombre, 'codigo', p.codigo)
                        from sgc.proyectos p where p.id = po.proyecto_id),
         'registrado_por_nombre', (select u.nombre from sgc.usuarios u where u.id = po.registrado_por),
         'tiene_contrato', exists (select 1 from sgc.personal_obra_firmas f where f.personal_id = po.id),
         'tiene_foto_persona', exists (select 1 from sgc.personal_obra_fotos ft
                                       where ft.personal_id = po.id and ft.tipo = 'persona')
       )
    order by po.created_at desc), '[]'::jsonb)
  from sgc.personal_obra po
  where (p_proyecto is null or po.proyecto_id = p_proyecto)
    and po.eliminado_at is null
    and sgc.puede_ver_personal_obra(po.proyecto_id);
$function$;
grant execute on function sgc.listar_personal_obra(uuid) to authenticated;
