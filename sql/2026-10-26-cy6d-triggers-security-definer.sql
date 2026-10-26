-- CY6 -- fix: los triggers de captura (maestros y documentos) NO eran
-- SECURITY DEFINER. En produccion real todo pasa por RPCs SECURITY DEFINER
-- (crear_articulo_app, confirmar_entrada_chofer, etc.), asi que el trigger
-- hereda esos privilegios elevados y nunca se nota -- pero se encontro al
-- probar un INSERT directo bajo rol `authenticated` (sin pasar por una RPC):
-- el trigger intenta leer sgc.odoo_instancias, que `authenticated` NO puede
-- ver (correctamente, por diseno de F5) -- "permission denied for table
-- odoo_instancias", la transaccion completa fallaba.
--
-- Fix: ambos trigger functions pasan a SECURITY DEFINER, igual que el resto
-- de las funciones de esta integracion. Nadie invoca un trigger function
-- directamente (no es una RPC callable), asi que no amplia superficie de
-- ataque -- solo hace que el trigger funcione sin importar que rol disparo
-- el INSERT/UPDATE que lo activa.
begin;

create or replace function sgc.odoo_v1_capturar_evento_maestro()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_tipo text;
  v_id text;
  v_accion text;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_revision integer;
  v_es_prueba boolean;
begin
  v_tipo := case tg_table_name
    when 'articulos' then 'articulo'
    when 'categorias_inventario' then 'categoria_inventario'
    when 'unidades' then 'unidad'
    when 'proveedores' then 'proveedor'
  end;
  v_id := (to_jsonb(new)->>'id');
  v_accion := case tg_op when 'INSERT' then 'crear' else 'actualizar' end;
  v_es_prueba := coalesce((to_jsonb(new)->>'es_prueba')::boolean, false);

  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then
    return new;
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    return new;
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  select coalesce(max(revision), 0) + 1 into v_revision
    from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = v_id;

  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_instancia_id, v_tipo, v_id, v_accion, v_revision, to_jsonb(new), v_es_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing;

  return new;
end;
$fn$;
comment on function sgc.odoo_v1_capturar_evento_maestro is 'SGC Odoo foundation v1 (CY6) -- SECURITY DEFINER: funciona sin importar el rol que disparo el INSERT/UPDATE.';

create or replace function sgc.odoo_v1_capturar_evento_documento()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_tipo text;
  v_id text := new.id::text;
  v_accion text := case tg_op when 'INSERT' then 'crear' else 'actualizar' end;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_revision integer;
  v_es_prueba boolean;
  v_payload jsonb;
begin
  if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then
    return new;
  end if;

  v_tipo := case tg_table_name
    when 'entradas_inventario' then 'entrada_inventario'
    when 'salidas_inventario' then 'salida_inventario'
    when 'retiros_material' then 'retiro_material'
    when 'solicitudes_compra' then 'solicitud_compra'
  end;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then return new; end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  if v_tipo = 'entrada_inventario' then
    select to_jsonb(e) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.entradas_inventario e left join sgc.detalle_entradas d on d.entrada_id = e.id
      where e.id = new.id group by e.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'salida_inventario' then
    select to_jsonb(s) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(d)) filter (where d.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.salidas_inventario s left join sgc.detalle_salidas d on d.salida_id = s.id
      where s.id = new.id group by s.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'retiro_material' then
    select to_jsonb(r) || jsonb_build_object(
        'lineas', coalesce((select jsonb_agg(to_jsonb(i)) from sgc.retiro_material_items i where i.retiro_id = r.id), '[]'::jsonb),
        'fotos', coalesce((select jsonb_agg(to_jsonb(f)) from sgc.retiro_material_fotos f where f.retiro_id = r.id), '[]'::jsonb)
      )
      into v_payload
      from sgc.retiros_material r where r.id = new.id;
    v_es_prueba := coalesce((v_payload->>'es_prueba')::boolean, false);
  elsif v_tipo = 'solicitud_compra' then
    select to_jsonb(sc) || jsonb_build_object('lineas', coalesce(jsonb_agg(to_jsonb(i)) filter (where i.id is not null), '[]'::jsonb))
      into v_payload
      from sgc.solicitudes_compra sc left join sgc.solicitud_compra_items i on i.solicitud_id = sc.id
      where sc.id = new.id group by sc.id;
    v_es_prueba := false;
  end if;

  if v_payload is null then return new; end if;

  select coalesce(max(revision), 0) + 1 into v_revision
    from sgc.odoo_eventos where agregado_tipo = v_tipo and agregado_id = v_id;

  insert into sgc.odoo_eventos (odoo_instancia_id, agregado_tipo, agregado_id, accion, revision, payload, es_prueba)
    values (v_instancia_id, v_tipo, v_id, v_accion, v_revision, v_payload, v_es_prueba)
  on conflict (odoo_instancia_id, agregado_tipo, agregado_id, revision) do nothing;

  return new;
end;
$fn$;
comment on function sgc.odoo_v1_capturar_evento_documento is 'SGC Odoo foundation v1 (CY6 resto) -- SECURITY DEFINER: funciona sin importar el rol que disparo el INSERT/UPDATE.';

commit;
