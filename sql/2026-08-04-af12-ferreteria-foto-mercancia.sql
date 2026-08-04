-- AF12 — Compra en ferretería: además de la foto del RECIBO, una foto de la
-- MERCANCÍA recibida. Aditivo y retrocompatible: columna nueva + overload del RPC
-- con un parámetro extra (el overload de 10 args se conserva ≥2 versiones).

alter table sgc.entradas_inventario
  add column if not exists foto_mercancia_path text;

-- Overload con la foto de mercancía (11 args). El de 10 args (sin foto mercancía)
-- se mantiene para versiones viejas de la app (regla de compat ≥2 versiones).
create or replace function sgc.chofer_registrar_compra_ferreteria(
  p_id uuid,
  p_fecha date,
  p_bodega_id uuid,
  p_proveedor_id uuid default null,
  p_proyecto_id uuid default null,
  p_orden_compra_id uuid default null,
  p_referencia text default null,
  p_observaciones text default null,
  p_foto_path text default null,
  p_items jsonb default '[]'::jsonb,
  p_foto_mercancia_path text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_es_chofer boolean;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  v_es_chofer := exists (select 1 from sgc.conductores where usuario_id = v_uid and coalesce(activo,true));
  if not (v_es_chofer or sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Sin permiso para registrar compras de ferretería';
  end if;
  if p_bodega_id is null then raise exception 'La bodega/almacén destino es obligatoria'; end if;

  select id into v_existing from sgc.entradas_inventario where id = p_id;
  if v_existing is not null then return v_existing; end if;

  insert into sgc.entradas_inventario (
    id, fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones,
    origen_tipo, origen_proyecto_id, foto_path, foto_mercancia_path, creado_por, registrado_por,
    pendiente_confirmacion, items_propuestos
  ) values (
    coalesce(p_id, gen_random_uuid()), coalesce(p_fecha, current_date), p_bodega_id,
    p_proveedor_id, p_orden_compra_id, nullif(p_referencia,''), nullif(p_observaciones,''),
    'compra', p_proyecto_id, nullif(p_foto_path,''), nullif(p_foto_mercancia_path,''), v_uid, v_uid,
    true, coalesce(p_items,'[]'::jsonb)
  ) returning id into v_existing;

  perform sgc.notificar_modulo('inventario', 'info',
    'Compra de ferretería por confirmar',
    'Un chofer registró una compra/retiro que debe confirmar Almacén.',
    '/inventario/entradas');

  return v_existing;
end;
$$;

grant execute on function sgc.chofer_registrar_compra_ferreteria(uuid,date,uuid,uuid,uuid,uuid,text,text,text,jsonb,text) to authenticated, service_role;
