-- CY24 Fase C [feature #24] -- tercera pieza: confirmar/cancelar una OC ya
-- publicada + grabar la identidad Odoo (odoo_instancia_id/odoo_id) la
-- primera vez que compras.crear publica con éxito.
--
-- sgc.registrar_publicacion_oc (Fase A, sql/2026-10-26-cy24-oc-odoo-a.sql) se
-- reemplaza por una versión con 3 parámetros nuevos -- DROP explícito antes
-- del CREATE porque cambia el número de parámetros (nunca dejar un overload
-- ambiguo, gotcha ya vivido en este repo con crear_mantenimiento_app).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

drop function if exists sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text);

create or replace function sgc.registrar_publicacion_oc(
  p_orden_id uuid, p_odoo_sync_estado text, p_odoo_state text default null,
  p_odoo_nombre text default null, p_odoo_total numeric default null, p_odoo_sync_error text default null,
  p_odoo_instancia_id uuid default null, p_odoo_id bigint default null
)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o service_role puede registrar el resultado de una publicacion' using errcode = '42501';
  end if;
  if p_odoo_sync_estado not in ('pendiente', 'publicada', 'confirmada', 'cancelada', 'error', 'conflicto') then
    raise exception 'p_odoo_sync_estado invalido: %', p_odoo_sync_estado;
  end if;
  update sgc.ordenes_compra
     set odoo_sync_estado = p_odoo_sync_estado,
         odoo_state = coalesce(p_odoo_state, odoo_state),
         odoo_nombre = coalesce(p_odoo_nombre, odoo_nombre),
         odoo_total = coalesce(p_odoo_total, odoo_total),
         odoo_sync_error = p_odoo_sync_error, -- se pisa siempre: null = "sin error" explicito
         -- Identidad (F5): se fija UNA sola vez -- un reintento/confirmación posterior
         -- nunca la pisa, aunque mande los mismos valores.
         odoo_instancia_id = coalesce(odoo_instancia_id, p_odoo_instancia_id),
         odoo_id = coalesce(odoo_id, p_odoo_id)
   where id = p_orden_id;
  return found;
end;
$fn$;
comment on function sgc.registrar_publicacion_oc is 'SGC Odoo foundation v1 (CY24 Fase A/C) -- NO publica en Odoo, solo registra el resultado de una publicación/confirmación/cancelación ya hecha. Fija odoo_instancia_id/odoo_id UNA sola vez (primera publicación exitosa).';
revoke all on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) from public, anon;
grant execute on function sgc.registrar_publicacion_oc(uuid, text, text, text, numeric, text, uuid, bigint) to authenticated, service_role;

-- RPC: valida y ensambla lo necesario para confirmar/cancelar una OC YA
-- publicada (identidad odoo_id ya existe). Separada de oc_para_publicar
-- porque las precondiciones son distintas (esa exige proveedor+líneas sin
-- publicar; esta exige que YA esté publicada).
create or replace function sgc.oc_para_comando(p_orden_id uuid, p_accion text)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_oc sgc.ordenes_compra;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
begin
  if p_accion not in ('confirmar', 'cancelar') then
    raise exception 'accion invalida para oc_para_comando: %', p_accion;
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede % una orden de compra en Odoo', p_accion using errcode = '42501';
  end if;

  select * into v_oc from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada'; end if;

  -- D-16/E10: igual que al publicar, una OC de prueba nunca toca Odoo.
  if coalesce(v_oc.es_prueba, false) then
    raise exception 'Una orden de compra de prueba no se publica en Odoo' using errcode = '22023';
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada para publicar' using errcode = '22023';
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  if v_oc.odoo_instancia_id is distinct from v_instancia_id or v_oc.odoo_id is null then
    raise exception 'Esta orden todavía no se ha publicado en Odoo' using errcode = '22023';
  end if;
  if v_oc.odoo_sync_estado = 'cancelada' then
    raise exception 'Esta orden ya está cancelada en Odoo' using errcode = '22023';
  end if;
  if p_accion = 'confirmar' and v_oc.odoo_sync_estado = 'confirmada' then
    raise exception 'Esta orden ya está confirmada en Odoo' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'odoo_instancia_id', v_instancia_id, 'orden_id', v_oc.id, 'odoo_id', v_oc.odoo_id,
    'numero', v_oc.numero, 'odoo_sync_estado_actual', v_oc.odoo_sync_estado
  );
end;
$fn$;
comment on function sgc.oc_para_comando is 'CY24 Fase C -- valida (D-16, ya-publicada, estado terminal) y ensambla una OC para confirmar/cancelar; el edge nunca confía en lo que mande el navegador (D5).';
revoke all on function sgc.oc_para_comando(uuid, text) from public, anon;
grant execute on function sgc.oc_para_comando(uuid, text) to authenticated, service_role;

commit;
