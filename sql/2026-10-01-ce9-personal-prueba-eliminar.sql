-- CE9 — Admin: marcar un personal de obra como prueba / eliminar (lógico) + papelera
-- ---------------------------------------------------------------------------------
-- Las columnas de borrado lógico (eliminado_at/por/motivo) se crearon en
-- 2026-10-01-ce2-ce16-personal.sql.  Aquí van los RPC (solo admin) + la papelera 30d.
-- Un eliminado desaparece de listas/KPI/carnets/asistencia (listar_personal_obra ya
-- filtra eliminado_at is null); se puede restaurar 30 días.
-- ---------------------------------------------------------------------------------

-- Marcar/desmarcar como prueba (patrón es_prueba ya existente).
create or replace function sgc.marcar_personal_prueba(p_id uuid, p_es_prueba boolean)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar registros como prueba' using errcode = '42501';
  end if;
  update sgc.personal_obra set es_prueba = coalesce(p_es_prueba,false), updated_at = now()
   where id = p_id and eliminado_at is null;
  if not found then raise exception 'Registro no encontrado' using errcode = '22023'; end if;
end;
$function$;
grant execute on function sgc.marcar_personal_prueba(uuid, boolean) to authenticated;

-- Eliminar (borrado lógico con motivo).
create or replace function sgc.eliminar_personal_obra(p_id uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede eliminar personal de obra' using errcode = '42501';
  end if;
  update sgc.personal_obra
     set eliminado_at = now(), eliminado_por = auth.uid(),
         eliminado_motivo = nullif(trim(p_motivo),''), updated_at = now()
   where id = p_id and eliminado_at is null;
  if not found then raise exception 'Registro no encontrado o ya eliminado' using errcode = '22023'; end if;
end;
$function$;
grant execute on function sgc.eliminar_personal_obra(uuid, text) to authenticated;

-- Restaurar desde la papelera (dentro de 30 días).
create or replace function sgc.restaurar_personal_obra(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede restaurar personal de obra' using errcode = '42501';
  end if;
  update sgc.personal_obra
     set eliminado_at = null, eliminado_por = null, eliminado_motivo = null, updated_at = now()
   where id = p_id and eliminado_at is not null and eliminado_at > now() - interval '30 days';
  if not found then raise exception 'No se puede restaurar (no existe o pasaron 30 días)' using errcode = '22023'; end if;
end;
$function$;
grant execute on function sgc.restaurar_personal_obra(uuid) to authenticated;

-- Papelera: eliminados en los últimos 30 días (solo admin).
create or replace function sgc.papelera_personal_obra()
returns jsonb
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', po.id, 'nombre', po.nombre, 'documento_numero', po.documento_numero,
    'proyecto', (select p.nombre from sgc.proyectos p where p.id = po.proyecto_id),
    'eliminado_at', po.eliminado_at,
    'eliminado_por', (select u.nombre from sgc.usuarios u where u.id = po.eliminado_por),
    'eliminado_motivo', po.eliminado_motivo
  ) order by po.eliminado_at desc), '[]'::jsonb)
  from sgc.personal_obra po
  where sgc.is_admin()
    and po.eliminado_at is not null
    and po.eliminado_at > now() - interval '30 days';
$function$;
grant execute on function sgc.papelera_personal_obra() to authenticated;
