-- AZ7 — Marcar/desmarcar un usuario existente como de prueba desde Gestión de Usuarios.
-- Solo admin. es_prueba saca al usuario de KPIs/correos/incentivos (mismo efecto que un
-- usuario test creado sin correo). Desmarcar está permitido (con confirmación en la UI).
-- Registra la acción en el log inmutable de admin (audit_log).

create or replace function sgc.marcar_usuario_prueba(p_id uuid, p_valor boolean)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar usuarios de prueba.';
  end if;
  if p_id = auth.uid() then
    raise exception 'No puedes marcarte a ti mismo como usuario de prueba.';
  end if;
  update sgc.usuarios set es_prueba = coalesce(p_valor, false) where id = p_id;
  insert into sgc.audit_log(actor_id, action, target_user_id, metadata)
  values (auth.uid(),
          case when p_valor then 'usuario_marcado_prueba' else 'usuario_desmarcado_prueba' end,
          p_id,
          jsonb_build_object('es_prueba', coalesce(p_valor, false)));
end;
$function$;

grant execute on function sgc.marcar_usuario_prueba(uuid, boolean) to authenticated;
