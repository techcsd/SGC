-- BT7 — Transferir/crear un «Conduce externo» revienta con una FK y le muestra el SQL
-- al chofer. Nota #46: "A user tried to transfer a 'Conduce externo' but something was
-- wrong, let's check it." (Pendiente `Conduce externo · Revisar dato`,
-- `insert or update on table "conduces_externos" violates foreign key constraint
-- "conduces_externos_transporta_proveedor_id_fkey"`, transporta_proveedor_id=497717a1-…).
--
-- CAUSA EXACTA (verificada por objeto en prod, 17-sep):
--   El UUID 497717a1-eb45-4566-b6b2-673f8b0fad28 = «FELIPE ( VIEJO )» en sgc.PROVEEDORES
--   (tipos = {transportista}, activo). El picker de "quién transporta" viene de
--   `proveedores_transporte_listado()`, que YA lee de sgc.proveedores where
--   'transportista' = any(tipos). PERO las FK de conduces_externos / viajes_transporte /
--   retiros_material siguen apuntando a la tabla VIEJA `sgc.proveedores_transporte`, que
--   está VACÍA (0 filas) y quedó como puente sin retirar. Modelo migrado (los listados y
--   los `viajes` ya leen `proveedores`) pero **las FK nunca se re-apuntaron** → REGLA 12:
--   cuando un modelo reemplaza a otro, el viejo se retira o se documenta quién lo lee.
--   Resultado: TODO id de proveedor de transporte real (todos viven en `proveedores`)
--   viola la FK → el conduce externo con proveedor NUNCA pudo persistir (conduces_externos
--   = 0 filas totales en prod). Hipótesis (i)/(ii)/(iii) del CONTEXTO descartadas: no es el
--   usuario en el campo de proveedor, ni un id borrado, ni RLS — es la FK apuntando a la
--   tabla muerta.
--
-- FIX (2 bugs de la nota):
--   1) Re-apuntar las 3 FK a sgc.proveedores(id) (la tabla viva). Seguro: las 3 columnas
--      tienen 0 valores no-null hoy (la FK vieja lo impedía). `proveedores_transporte` y
--      `proveedor_transporte_map` quedan RETIRADAS (vacías, sin lectores tras esto salvo el
--      map que también está vacío) — documentado aquí (regla 12).
--   2) `crear_conduce_externo` VALIDA el proveedor antes del insert (regla 9/16): si el id
--      no es un transportista activo de `proveedores` → `error_campo(...)` = 22023 negocio
--      ("Revisar dato"), NUNCA deja que la FK 23503 explote y le muestre SQL al chofer.
--   La persona («Otro», sin empresa) sigue por `transporta_texto` (CHECK ya lo permite) —
--   no se añade columna de persona: el modelo de "empresa (proveedor) o texto libre" ya
--   cubre ambos casos y es lo que la app/web pueblan (paridad, sin scope creep).
--
-- Aditiva y retrocompatible (0 filas afectadas). begin/rollback validado en prod.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-17-bt7-conduce-externo-validacion.sql

begin;

-- 1) Re-apuntar las FK del modelo vivo (regla 12) --------------------------------
-- conduces_externos.transporta_proveedor_id
alter table sgc.conduces_externos
  drop constraint if exists conduces_externos_transporta_proveedor_id_fkey;
alter table sgc.conduces_externos
  add constraint conduces_externos_transporta_proveedor_id_fkey
  foreign key (transporta_proveedor_id) references sgc.proveedores(id);

-- viajes_transporte.proveedor_id (el RPC inserta un viaje por conduce)
alter table sgc.viajes_transporte
  drop constraint if exists viajes_transporte_proveedor_id_fkey;
alter table sgc.viajes_transporte
  add constraint viajes_transporte_proveedor_id_fkey
  foreign key (proveedor_id) references sgc.proveedores(id);

-- retiros_material.transporta_proveedor_id (mismo modelo de "quién transporta")
alter table sgc.retiros_material
  drop constraint if exists retiros_material_transporta_proveedor_id_fkey;
alter table sgc.retiros_material
  add constraint retiros_material_transporta_proveedor_id_fkey
  foreign key (transporta_proveedor_id) references sgc.proveedores(id);

-- Retiro documentado del modelo viejo (regla 12): estas tablas quedan vacías y sin
-- lectores de negocio. NO se dropean (blast radius mínimo); su comentario nombra esta
-- migración como el inventario de retiro.
comment on table sgc.proveedores_transporte is
  'RETIRADA (BT7, 2026-09-17). Los proveedores de transporte viven en sgc.proveedores '
  'con tipos @> {transportista}; los listados/viajes/conduces ya leen esa tabla. Vacía. '
  'Candidata a DROP en una ronda futura si el map sigue vacío.';
comment on table sgc.proveedor_transporte_map is
  'RETIRADA (BT7, 2026-09-17). Puente old→new nunca poblado (0 filas). Ver proveedores_transporte.';

-- 2) crear_conduce_externo valida el proveedor (regla 9/16) ----------------------
create or replace function sgc.crear_conduce_externo(
  p_transporta_proveedor_id uuid,
  p_transporta_texto text,
  p_placa_foto_path text,
  p_carga_foto_path text default null,
  p_material_descripcion text default null,
  p_items jsonb default null,
  p_origen text default null,
  p_origen_lat numeric default null,
  p_origen_lng numeric default null,
  p_origen_proyecto_id uuid default null,
  p_origen_bodega_id uuid default null,
  p_destino text default null,
  p_destino_lat numeric default null,
  p_destino_lng numeric default null,
  p_destino_proyecto_id uuid default null,
  p_destino_bodega_id uuid default null,
  p_emisor_firma_path text default null,
  p_origen_requisicion_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_prueba boolean := sgc.usuario_actual_es_prueba();
  v_salida_id uuid;
  v_entrada_id uuid;
  v_afecta boolean := false;
  v_resp text;
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No puedes crear conduces (no eres transportista ni tienes el módulo Inventario).';
  end if;
  if nullif(btrim(coalesce(p_placa_foto_path,'')),'') is null then
    raise exception 'La foto de la placa del camión es obligatoria.';
  end if;
  if p_transporta_proveedor_id is null and nullif(btrim(coalesce(p_transporta_texto,'')),'') is null then
    raise exception 'Indica quién transporta (proveedor o texto «Otro»).';
  end if;

  -- BT7: valida el proveedor de transporte ANTES del insert (regla 9/16). Si el id no es
  -- un transportista activo de `proveedores`, es un dato a corregir (22023, negocio), no
  -- una avería que le muestre la FK cruda al chofer.
  if p_transporta_proveedor_id is not null
     and not exists (
       select 1 from sgc.proveedores p
       where p.id = p_transporta_proveedor_id
         and 'transportista' = any(coalesce(p.tipos, array[]::text[]))
         and coalesce(p.activo, true)
     ) then
    perform sgc.error_campo(
      'transporta_proveedor_id', 'no_existe',
      'Ese proveedor de transporte ya no está disponible. Elige otro o escribe quién transporta.');
  end if;

  select nombre into v_resp from sgc.usuarios where id = auth.uid();

  -- Impacto de inventario (solo si hay items del catálogo y toca un almacén nuestro).
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    if p_origen_bodega_id is not null then
      v_salida_id := sgc.registrar_salida_inventario(
        current_date, p_origen_bodega_id, p_destino_proyecto_id, 'conduce_externo',
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      v_entrada_id := sgc.registrar_entrada_inventario(
        current_date, p_destino_bodega_id, null, null, 'Conduce externo',
        coalesce(p_material_descripcion,''), auth.uid(), p_items, 'otros', p_origen_proyecto_id);
      v_afecta := true;
    end if;
  end if;

  insert into sgc.conduces_externos (
    transporta_proveedor_id, transporta_texto, placa_foto_path, carga_foto_path,
    material_descripcion, afecta_inventario, salida_id, entrada_id,
    origen, origen_lat, origen_lng, origen_proyecto_id, origen_bodega_id,
    destino, destino_lat, destino_lng, destino_proyecto_id, destino_bodega_id,
    emisor_firma_path, origen_requisicion_id, es_prueba)
  values (
    p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), p_placa_foto_path, p_carga_foto_path,
    nullif(btrim(p_material_descripcion),''), v_afecta, v_salida_id, v_entrada_id,
    nullif(btrim(p_origen),''), p_origen_lat, p_origen_lng, p_origen_proyecto_id, p_origen_bodega_id,
    nullif(btrim(p_destino),''), p_destino_lat, p_destino_lng, p_destino_proyecto_id, p_destino_bodega_id,
    p_emisor_firma_path, p_origen_requisicion_id, v_prueba)
  returning id into v_id;

  -- Viaje automático al proveedor (o texto).
  insert into sgc.viajes_transporte (proveedor_id, proveedor_texto, conduce_externo_id, fecha, es_prueba)
  values (p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), v_id, current_date, v_prueba);

  -- «Otros» sin coordenadas ni obra/almacén → bandeja "Lugares por registrar".
  if nullif(btrim(p_origen),'') is not null and p_origen_lat is null
     and p_origen_proyecto_id is null and p_origen_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_origen, 'conduce_externo', v_id, 'origen');
  end if;
  if nullif(btrim(p_destino),'') is not null and p_destino_lat is null
     and p_destino_proyecto_id is null and p_destino_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_destino, 'conduce_externo', v_id, 'destino');
  end if;

  return v_id;
end;
$function$;

commit;
