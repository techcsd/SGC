-- CY25 -- Proveedores y solicitudes de compra sobre Odoo directo (SGC lee/escribe Odoo por el gateway).
--
-- Contexto: la pantalla /compras/proveedores-odoo lista y edita proveedores en Odoo (res.partner) y
-- mantiene en sgc.proveedores SOLO la fila local con lo OPERATIVO (tipos, ferreteria, lat/lng...),
-- enlazada por (odoo_instancia_id, odoo_id), para no romper las FKs uuid de otras tablas.
-- /compras/solicitar-odoo elige productos de Odoo y necesita guardarlos en la solicitud.
--
--   1. sgc.vincular_proveedor_odoo(uuid, bigint)  -- fija el vinculo proveedor local <-> res.partner (una vez).
--   2. sgc.asegurar_proveedor_odoo(bigint, text)  -- devuelve el uuid local de un partner de Odoo (lo crea minimo
--                                                    si no existe) para poder usarlo en una OC/entrada (FK uuid).
--   3. sgc.solicitud_compra_items: odoo_product_id / odoo_uom_id / odoo_snapshot (aditivo, nullable).
--   4. sgc.crear_solicitud_compra (MISMA firma de 6 args de BH8): ahora persiste odoo_*, articulo_id y unidad.
--   5. sgc._entero_positivo_jsonb: utilidad pura para validar ids que llegan en jsonb (usada por 4).
--
-- ANTI-BUCLE (outbox): sgc.proveedores tiene el trigger AFTER INSERT/UPDATE `odoo_v1_capturar_evento_maestro`
-- (cy6/cy6d) que ENCOLA un evento hacia Odoo en cada escritura. Aqui el dato YA VIENE de Odoo, asi que
-- encolarlo haria que el integrador intente crear/actualizar en Odoo un partner que ya existe (duplicado).
-- El trigger se omite cuando `current_setting('sgc.odoo_importando', true) = 'true'` (cy6d, linea
-- "if coalesce(current_setting('sgc.odoo_importando', true), 'false') = 'true' then return new"). Las funciones
-- 1 y 2 hacen `set_config('sgc.odoo_importando','true', true)` (local a la transaccion) JUSTO alrededor de su
-- unica escritura y RESTAURAN el valor previo despues, para no silenciar el outbox de lo que el llamador
-- escriba luego en la misma transaccion.
--
-- PERMISOS DE ESCRITURA DE IDENTIDAD: el trigger `odoo_v1_proteger_campos` (security INVOKER) bloquea escribir
-- odoo_instancia_id/odoo_id/... a quien no sea service_role/postgres/supabase_admin segun `current_user`.
-- Las funciones 1 y 2 son SECURITY DEFINER: `current_user` es su DUENO (el rol que corre esta migracion), que
-- por eso debe ser postgres/supabase_admin/service_role -- lo verifica el preflight. Mismo mecanismo que
-- sgc.vincular_oc_odoo (cy24k).
--
-- LO QUE NO SE TOCA A PROPOSITO:
--   * sgc.aprobar_solicitud_compra y sgc.crear_orden_compra conservan su firma y su cuerpo. Los odoo_* de los
--     renglones de la solicitud los lee la capa de aplicacion; si hace falta propagarlos a orden_compra_items,
--     sera otra migracion (con DROP explicito de la firma anterior, sin overloads ambiguos).
--   * sgc.crear_solicitud_compra NO cambia de firma (no hay DROP): sigue siendo (uuid, uuid, text, jsonb, uuid,
--     text) y SECURITY INVOKER, igual que BH8 (la RLS de solicitudes_compra/solicitud_compra_items sigue mandando).
--   * Triggers, politicas RLS y grants de tablas existentes: sin cambios. solicitud_compra_items ya tiene
--     `grant select, insert to authenticated` a nivel de tabla, que cubre las columnas nuevas.
--   * odoo_v1_capturar_evento_maestro / odoo_v1_proteger_campos / outbox: sin cambios.
--   * sgc.proveedores: sin columnas ni indices nuevos (se usa el unico parcial odoo_v1_proveedores_odoo_id_uq).
--     No hay secuencias nuevas ni involucradas (proveedores.id y solicitud_compra_items.id son uuid).
--
-- Archivo nuevo a propósito (CD10 / regla 19). Dev primero (BU1).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
set local search_path = sgc, public;

do $preflight$
declare
  v_col text;
begin
  if to_regclass('sgc.odoo_instancias') is null then
    raise exception 'Falta sgc.odoo_instancias -- aplicar antes sql/20261016112524_odoo_identity_fields.sql';
  end if;
  if to_regclass('sgc.proveedores') is null or to_regclass('sgc.solicitud_compra_items') is null
     or to_regclass('sgc.solicitudes_compra') is null then
    raise exception 'Faltan sgc.proveedores / sgc.solicitudes_compra / sgc.solicitud_compra_items';
  end if;

  -- Columnas que esta migracion lee o escribe.
  foreach v_col in array array['nombre', 'activo', 'odoo_instancia_id', 'odoo_id', 'odoo_ultima_sync'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'sgc' and table_name = 'proveedores' and column_name = v_col) then
      raise exception 'Falta sgc.proveedores.% -- aplicar antes sql/20261016112524_odoo_identity_fields.sql', v_col;
    end if;
  end loop;
  foreach v_col in array array['solicitud_id', 'descripcion', 'cantidad', 'proveedor_sugerido', 'articulo_id', 'unidad'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'sgc' and table_name = 'solicitud_compra_items' and column_name = v_col) then
      raise exception 'Falta sgc.solicitud_compra_items.% -- aplicar antes sql/2026-09-02-bh7-solicitud-compra-articulo-id.sql', v_col;
    end if;
  end loop;
  foreach v_col in array array['proyecto_id', 'solicitante_id', 'notas', 'origen_requisicion_id', 'categoria'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'sgc' and table_name = 'solicitudes_compra' and column_name = v_col) then
      raise exception 'Falta sgc.solicitudes_compra.% -- crear_solicitud_compra (BH8) no se puede reemplazar', v_col;
    end if;
  end loop;

  -- El unico parcial sobre el que descansa ON CONFLICT en asegurar_proveedor_odoo.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'sgc' and tablename = 'proveedores' and indexname = 'odoo_v1_proveedores_odoo_id_uq'
       and indexdef ilike '%unique%' and indexdef ilike '%(odoo_instancia_id, odoo_id)%'
  ) then
    raise exception 'Falta el indice unico sgc.odoo_v1_proveedores_odoo_id_uq (odoo_instancia_id, odoo_id)';
  end if;

  -- Helpers de autorizacion que usan las funciones DEFINER.
  if to_regprocedure('sgc.is_admin()') is null or to_regprocedure('sgc.tiene_modulo(text)') is null then
    raise exception 'Faltan sgc.is_admin() / sgc.tiene_modulo(text)';
  end if;

  -- La firma vigente (BH8) debe existir exactamente: aqui se reemplaza su cuerpo, no se crea un overload.
  if to_regprocedure('sgc.crear_solicitud_compra(uuid, uuid, text, jsonb, uuid, text)') is null then
    raise exception 'Falta sgc.crear_solicitud_compra(uuid, uuid, text, jsonb, uuid, text) -- aplicar antes sql/2026-09-02-bh8-crear-solicitud-compra-manual.sql';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'sgc' and p.proname = 'crear_solicitud_compra') <> 1 then
    raise exception 'Hay mas de una sobrecarga de sgc.crear_solicitud_compra -- resolver antes (ambigüedad en PostgREST)';
  end if;

  -- El trigger odoo_v1_proteger_campos deja pasar solo a service_role/postgres/supabase_admin; las funciones
  -- DEFINER heredan el rol de quien corre esta migracion.
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Esta migracion debe correr como postgres/supabase_admin (las funciones DEFINER heredan ese rol para escribir odoo_*); actual: %', current_user;
  end if;
end;
$preflight$;

-- ── 3) Columnas Odoo en los renglones de la solicitud (mismos checks que orden_compra_items, cy24) ──
alter table sgc.solicitud_compra_items
  add column if not exists odoo_product_id bigint check (odoo_product_id is null or odoo_product_id > 0),
  add column if not exists odoo_uom_id bigint check (odoo_uom_id is null or odoo_uom_id > 0),
  add column if not exists odoo_snapshot jsonb;
comment on column sgc.solicitud_compra_items.odoo_product_id is 'CY25 -- product.product de Odoo elegido en /compras/solicitar-odoo. NULL = renglon libre / de catalogo SGC.';
comment on column sgc.solicitud_compra_items.odoo_uom_id is 'CY25 -- uom.uom de Odoo del renglon.';
comment on column sgc.solicitud_compra_items.odoo_snapshot is 'CY25 -- copia de lo que devolvio productos.obtener al elegir el producto (AT11: todo lo enviado debe poder verse). Objeto jsonb.';

-- ── 5) Utilidad pura: entero positivo desde un jsonb (null/ausente -> null; tipo invalido -> error legible) ──
create or replace function sgc._entero_positivo_jsonb(p_valor jsonb, p_campo text)
returns bigint
language plpgsql
immutable
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_txt text;
  v_n bigint;
begin
  if p_valor is null or jsonb_typeof(p_valor) = 'null' then
    return null;
  end if;
  v_txt := p_valor #>> '{}';
  if jsonb_typeof(p_valor) <> 'number' or v_txt !~ '^[0-9]{1,18}$' then
    raise exception '% debe ser un entero positivo', p_campo;
  end if;
  v_n := v_txt::bigint;
  if v_n <= 0 then
    raise exception '% debe ser un entero positivo', p_campo;
  end if;
  return v_n;
end;
$fn$;
comment on function sgc._entero_positivo_jsonb is 'CY25 -- utilidad pura: jsonb number entero > 0 -> bigint; null -> null; otro -> error. La usa crear_solicitud_compra.';
revoke all on function sgc._entero_positivo_jsonb(jsonb, text) from public, anon;
grant execute on function sgc._entero_positivo_jsonb(jsonb, text) to authenticated, service_role;

-- ── 4) crear_solicitud_compra: MISMA firma y mismo comportamiento + odoo_*, articulo_id, unidad ──
-- Sigue siendo SECURITY INVOKER (como BH8). Conserva: autenticacion, "solo a tu nombre" (salvo admin),
-- origen_requisicion_id, categoria normalizada, y un renglon por elemento de p_items. Elementos viejos
-- (solo descripcion/cantidad/proveedor_sugerido) producen exactamente la misma fila que antes.
create or replace function sgc.crear_solicitud_compra(
  p_proyecto_id uuid,
  p_solicitante_id uuid,
  p_notas text,
  p_items jsonb,
  p_origen_requisicion_id uuid default null,
  p_categoria text default null
)
returns uuid
language plpgsql
as $$
declare
  v_solicitud_id uuid;
  v_item jsonb;
  v_snapshot jsonb;
  v_articulo_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if p_solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'Solo puedes crear solicitudes de compra a tu propio nombre.';
  end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los renglones de la solicitud deben ser una lista.';
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, notas, origen_requisicion_id, categoria)
  values (p_proyecto_id, p_solicitante_id, p_notas, p_origen_requisicion_id, nullif(btrim(p_categoria), ''))
  returning id into v_solicitud_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_snapshot := v_item -> 'odoo_snapshot';
    if v_snapshot is not null and jsonb_typeof(v_snapshot) not in ('object', 'null') then
      raise exception 'odoo_snapshot debe ser un objeto';
    end if;
    if v_snapshot is not null and jsonb_typeof(v_snapshot) = 'null' then
      v_snapshot := null;
    end if;

    begin
      v_articulo_id := nullif(btrim(coalesce(v_item ->> 'articulo_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'articulo_id no es un identificador valido';
    end;

    insert into sgc.solicitud_compra_items (
      solicitud_id, descripcion, cantidad, proveedor_sugerido,
      articulo_id, unidad, odoo_product_id, odoo_uom_id, odoo_snapshot
    ) values (
      v_solicitud_id, v_item ->> 'descripcion', (v_item ->> 'cantidad')::numeric, v_item ->> 'proveedor_sugerido',
      v_articulo_id,
      nullif(btrim(coalesce(v_item ->> 'unidad', '')), ''),
      sgc._entero_positivo_jsonb(v_item -> 'odoo_product_id', 'odoo_product_id'),
      sgc._entero_positivo_jsonb(v_item -> 'odoo_uom_id', 'odoo_uom_id'),
      v_snapshot
    );
  end loop;

  return v_solicitud_id;
end;
$$;
-- Los grants de la firma ya existen desde BH8; se reafirman (idempotente, no cambia a quien se le da).
grant execute on function sgc.crear_solicitud_compra(uuid, uuid, text, jsonb, uuid, text) to authenticated;

-- ── 1) Vincular un proveedor local a su res.partner de Odoo (una sola vez) ──
create or replace function sgc.vincular_proveedor_odoo(p_proveedor_id uuid, p_odoo_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_n integer;
  v_instancia uuid;
  v_prov record;
  v_otro text;
  v_guard_previo text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o service_role puede vincular un proveedor con Odoo' using errcode = '42501';
  end if;
  if p_proveedor_id is null or p_odoo_id is null or p_odoo_id <= 0 then
    raise exception 'Vínculo de proveedor con Odoo inválido';
  end if;

  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then
    raise exception 'Se esperaba exactamente una instancia de Odoo habilitada y hay %', v_n;
  end if;
  select id into v_instancia from sgc.odoo_instancias where habilitada;

  select id, nombre, odoo_instancia_id, odoo_id into v_prov
    from sgc.proveedores where id = p_proveedor_id for update;
  if not found then
    raise exception 'Proveedor no encontrado';
  end if;

  -- Se fija UNA sola vez: mismo vinculo = no-op; otro distinto = error (nunca se pisa en silencio).
  if v_prov.odoo_id is not null then
    if v_prov.odoo_instancia_id = v_instancia and v_prov.odoo_id = p_odoo_id then
      return true;
    end if;
    raise exception 'El proveedor "%" ya está vinculado a otro contacto de Odoo; no se sobrescribe', v_prov.nombre;
  end if;

  select nombre into v_otro from sgc.proveedores
   where odoo_instancia_id = v_instancia and odoo_id = p_odoo_id and id <> p_proveedor_id
   limit 1;
  if found then
    raise exception 'Ese contacto de Odoo ya está vinculado al proveedor "%"', v_otro;
  end if;

  -- El dato viene de Odoo: no encolar evento de outbox (ver cabecera). Se restaura el valor previo.
  v_guard_previo := current_setting('sgc.odoo_importando', true);
  perform set_config('sgc.odoo_importando', 'true', true);
  begin
    update sgc.proveedores
       set odoo_instancia_id = coalesce(odoo_instancia_id, v_instancia),
           odoo_id = coalesce(odoo_id, p_odoo_id),
           odoo_ultima_sync = now()
     where id = p_proveedor_id;
  exception when unique_violation then
    raise exception 'Ese contacto de Odoo ya está vinculado a otro proveedor';
  end;
  perform set_config('sgc.odoo_importando', coalesce(v_guard_previo, 'false'), true);

  return true;
end;
$fn$;
comment on function sgc.vincular_proveedor_odoo is 'CY25 -- fija el vínculo proveedor local <-> res.partner (una sola vez, instancia habilitada única). Sin evento de outbox (sgc.odoo_importando).';
revoke all on function sgc.vincular_proveedor_odoo(uuid, bigint) from public, anon;
grant execute on function sgc.vincular_proveedor_odoo(uuid, bigint) to authenticated, service_role;

-- ── 2) Asegurar la fila local de un partner de Odoo (para usarlo en OC/entrada por FK uuid) ──
create or replace function sgc.asegurar_proveedor_odoo(p_odoo_id bigint, p_nombre text)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_n integer;
  v_instancia uuid;
  v_id uuid;
  v_nombre text;
  v_guard_previo text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras o service_role puede registrar un proveedor de Odoo' using errcode = '42501';
  end if;
  if p_odoo_id is null or p_odoo_id <= 0 then
    raise exception 'Proveedor de Odoo inválido';
  end if;

  select count(*) into v_n from sgc.odoo_instancias where habilitada;
  if v_n <> 1 then
    raise exception 'Se esperaba exactamente una instancia de Odoo habilitada y hay %', v_n;
  end if;
  select id into v_instancia from sgc.odoo_instancias where habilitada;

  -- Camino rapido: ya existe (el nombre local NO se pisa: el nombre vive en Odoo).
  select id into v_id from sgc.proveedores where odoo_instancia_id = v_instancia and odoo_id = p_odoo_id;
  if v_id is not null then
    return v_id;
  end if;

  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is null then
    raise exception 'Falta el nombre del proveedor de Odoo para crear su registro local';
  end if;

  -- Sin evento de outbox (ver cabecera). Se restaura el valor previo del guard.
  v_guard_previo := current_setting('sgc.odoo_importando', true);
  perform set_config('sgc.odoo_importando', 'true', true);
  insert into sgc.proveedores (nombre, activo, odoo_instancia_id, odoo_id, odoo_ultima_sync)
  values (v_nombre, true, v_instancia, p_odoo_id, now())
  on conflict (odoo_instancia_id, odoo_id) where odoo_id is not null do nothing
  returning id into v_id;
  perform set_config('sgc.odoo_importando', coalesce(v_guard_previo, 'false'), true);

  -- Si otra transaccion lo creo a la vez, ON CONFLICT no devuelve fila: se lee el ganador.
  if v_id is null then
    select id into v_id from sgc.proveedores where odoo_instancia_id = v_instancia and odoo_id = p_odoo_id;
  end if;
  if v_id is null then
    raise exception 'No se pudo registrar el proveedor de Odoo; reintentar';
  end if;
  return v_id;
end;
$fn$;
comment on function sgc.asegurar_proveedor_odoo is 'CY25 -- devuelve el uuid local del partner de Odoo (instancia habilitada única); si no existe crea la fila mínima. Idempotente y concurrente (ON CONFLICT sobre el único parcial). Sin evento de outbox.';
revoke all on function sgc.asegurar_proveedor_odoo(bigint, text) from public, anon;
grant execute on function sgc.asegurar_proveedor_odoo(bigint, text) to authenticated, service_role;

commit;
