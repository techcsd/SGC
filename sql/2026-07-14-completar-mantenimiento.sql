-- Recomendación #3: al marcar un mantenimiento como hecho, resetear el contador
-- de "próximo mantenimiento" del vehículo (km_ultimo_mantenimiento) y atender los
-- avisos de mantenimiento pendientes de ese vehículo. Sin esto el contador solo se
-- reseteaba editando el vehículo a mano y los avisos vencido/pre_cita se repetían.
create or replace function sgc.completar_mantenimiento(p_id uuid, p_km int default null)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_veh uuid; v_km int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then raise exception 'No autorizado'; end if;

  select vehiculo_id, coalesce(p_km, kilometraje_al_mantenimiento)
    into v_veh, v_km
  from sgc.mantenimientos where id = p_id;
  if v_veh is null then raise exception 'Mantenimiento no encontrado'; end if;

  update sgc.mantenimientos
     set estado = 'completado',
         kilometraje_al_mantenimiento = coalesce(p_km, kilometraje_al_mantenimiento)
   where id = p_id;

  -- Resetear el contador del próximo mantenimiento.
  if v_km is not null then
    update sgc.vehiculos set km_ultimo_mantenimiento = v_km where id = v_veh;
  end if;

  -- Atender avisos de mantenimiento pendientes de ese vehículo.
  update sgc.avisos_flota
     set estado='atendido', atendido_por=auth.uid(), atendido_at=now(),
         nota_atencion='Mantenimiento completado'
   where vehiculo_id = v_veh and estado='pendiente'
     and tipo in ('mantenimiento_vencido','pre_cita');
end; $$;
grant execute on function sgc.completar_mantenimiento(uuid,int) to authenticated, service_role;
