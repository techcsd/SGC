-- AF6 — El usuario puede ELIMINAR sus notificaciones (swipe / "borrar todas").
-- Hasta ahora solo había políticas select/update (leído/no leído). Se agrega
-- delete acotado a las filas del propio usuario. Aditivo, retrocompatible.

drop policy if exists notif_del on sgc.notificaciones;
create policy notif_del on sgc.notificaciones
  for delete to authenticated using (usuario_id = auth.uid());

grant delete on sgc.notificaciones to authenticated;
