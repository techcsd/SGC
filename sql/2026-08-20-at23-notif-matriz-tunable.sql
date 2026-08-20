-- ============================================================================
-- AT23 — Matriz de notificaciones ADMINISTRABLE. La regla "quién recibe qué" de
-- los eventos con matriz vive en parámetros CSV de roles (sgc.parametros). Esto
-- expone una lectura + edición segura de esos parámetros para que un admin ajuste
-- los destinatarios SIN tocar código (la doc completa está en docs/NOTIFICACIONES-MATRIZ.md).
-- ============================================================================
set search_path = sgc, public;

-- Lectura de los parámetros de notificación tunables (solo admin).
create or replace function sgc.notif_config()
returns table(clave text, etiqueta text, descripcion text, valor text)
language sql stable security definer set search_path = sgc, public as $$
  select k.clave, k.etiqueta, k.descripcion, coalesce(p.valor, '')
  from (values
    ('confirmacion_roles_globales',
     'Confirmar conduces de CUALQUIER obra',
     'Roles que pueden confirmar y reciben el aviso "por confirmar" de conduces de TODAS las obras, sin vínculo con la obra. Manténlo corto (idealmente admin + logística): gerencia y dirección ven todo por sus vistas, no necesitan un aviso por cada conduce.'),
    ('confirmacion_roles_obra',
     'Confirmar conduces (roles de obra)',
     'Roles que confirman los conduces de las obras a las que SÍ están vinculados (capataz, ingeniero de campo, gerente de producción…).'),
    ('confirmacion_roles_almacen',
     'Confirmar conduces con destino almacén',
     'Roles que confirman cuando el destino del conduce es un almacén.'),
    ('aviso_vehiculo_roles',
     'Avisos de vehículo',
     'Roles que reciben los avisos de vehículo (novedades de flota).')
  ) as k(clave, etiqueta, descripcion)
  left join sgc.parametros p on p.clave = k.clave
  where sgc.is_admin();
$$;
grant execute on function sgc.notif_config() to authenticated, service_role;

-- Edición segura (whitelist) de un parámetro de notificación (solo admin).
create or replace function sgc.set_notif_param(p_clave text, p_valor text)
returns void
language plpgsql security definer set search_path = sgc, public as $$
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_clave not in ('confirmacion_roles_globales','confirmacion_roles_obra','confirmacion_roles_almacen','aviso_vehiculo_roles') then
    raise exception 'Parámetro de notificación no editable' using errcode = 'AT400';
  end if;
  -- Normaliza: quita espacios alrededor de cada rol del CSV.
  p_valor := (select string_agg(btrim(x), ',') from unnest(string_to_array(coalesce(p_valor,''), ',')) x where btrim(x) <> '');
  update sgc.parametros set valor = coalesce(p_valor, '') where clave = p_clave;
  if not found then
    insert into sgc.parametros (clave, valor) values (p_clave, coalesce(p_valor, ''));
  end if;
end;
$$;
grant execute on function sgc.set_notif_param(text, text) to authenticated, service_role;
