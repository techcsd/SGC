-- 2026-11-17 -- #65 / #81: decision de negocio (sin entrevista): Odoo es la fuente de verdad de proveedores. Los 1577 proveedores de SGC estan vinculados
-- y verificados contra Odoo (maestros), sin duplicados por nombre, asi que se RATIFICAN todos los vinculados y no de prueba. Los que se creen despues
-- en SGC quedan sin ratificar hasta que Compras los ratifique (pantalla Compras > Curacion) o se vinculen con Odoo.
-- No se enciende proveedores_selector_restringido: con todos ratificados no cambia nada y ocultaria a los nuevos.
do $$
declare v_admin uuid; v_n int;
begin
  select u.id into v_admin from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id = u.id join sgc.roles r on r.id = ur.rol_id
   where r.codigo = 'admin' and coalesce(u.activo, true) order by u.created_at limit 1;
  perform set_config('sgc.odoo_importando', 'true', true);
  update sgc.proveedores set ratificado_por = v_admin, ratificado_en = now()
   where ratificado_en is null and odoo_id is not null and coalesce(es_prueba, false) = false;
  get diagnostics v_n = row_count;
  raise notice 'proveedores ratificados: %', v_n;
end $$;
