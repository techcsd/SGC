-- CY4 [HU-INV-02] -- vinculos (SGC <-> Odoo) para operaciones de stock, con FKs
-- REALES a las tablas de negocio (nada de pareja generica tabla/UUID). No
-- modifica stock, no escribe en stock_por_bodega, no habilita publicacion de
-- documentos -- es solo la tabla de vinculo. Cardinalidad NO asumida 1:1: un
-- mismo documento Odoo puede enlazar varios documentos SGC (recepcion dividida)
-- y un mismo documento SGC puede enlazar varios documentos Odoo en distintas
-- etapas (ej. salida+entrada del mismo traslado interno). Contrato provisional
-- de docs/ODOO-DIAGNOSTICO-CONTRATO.md (CY18) -- se ajusta cuando Xaviel acepte
-- la matriz; esta migracion es aditiva y no bloquea ese ajuste.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

do $preflight$
begin
  if to_regclass('sgc.odoo_instancias') is null then
    raise exception 'Falta sgc.odoo_instancias -- aplica primero sql/20261016112524_odoo_identity_fields.sql en este entorno';
  end if;
  if to_regclass('sgc.odoo_vinculos_stock') is not null then
    raise exception 'sgc.odoo_vinculos_stock ya existe -- revisar antes de reaplicar';
  end if;
end;
$preflight$;

create table sgc.odoo_vinculos_stock (
  id uuid primary key default gen_random_uuid(),

  -- Identidad del lado Odoo. odoo_id es el entero NATIVO (nunca inferido de
  -- un odoo_ref que parezca numerico, nunca el XML/External ID).
  odoo_instancia_id uuid not null references sgc.odoo_instancias(id),
  odoo_modelo text not null check (odoo_modelo in ('stock.picking', 'stock.move', 'stock.scrap')),
  odoo_id bigint not null check (odoo_id > 0),

  -- Etapa/proposito del vinculo (no es un estado -- un documento SGC puede
  -- tener varios vinculos con etapas distintas a la vez, ej. traslado_salida +
  -- traslado_entrada apuntando al MISMO stock.picking).
  etapa text not null check (etapa in (
    'recepcion_compra', 'recepcion_parcial', 'traslado_salida', 'traslado_entrada',
    'conduce_externo', 'retiro', 'conteo'
  )),

  -- Exactamente UNA fk de origen SGC por fila (ck mas abajo). ON DELETE SET
  -- NULL: un origen borrado conserva el vinculo (historico), nunca se
  -- reutiliza como activo (lo marca origen_borrado_en).
  entrada_id uuid references sgc.entradas_inventario(id) on delete set null,
  salida_id uuid references sgc.salidas_inventario(id) on delete set null,
  conduce_externo_id uuid references sgc.conduces_externos(id) on delete set null,
  retiro_material_id uuid references sgc.retiros_material(id) on delete set null,
  conteo_inventario_id uuid references sgc.conteos_inventario(id) on delete set null,

  -- Rellenados por trigger a partir de la FK que SI se informo -- no se
  -- inventan a mano. Sirven para la unicidad y para consultar sin un UNION.
  origen_sgc_tipo text,
  origen_sgc_id uuid,
  origen_borrado_en timestamptz,

  -- Documentado (criterio 5): ubicacion de origen/transito/destino en Odoo
  -- (ids nativos de stock.location, no texto libre), unidad base del
  -- traslado y compania a la que pertenece. Nulos si la etapa no aplica
  -- (ej. recepcion_compra no tiene transito).
  odoo_ubicacion_origen_id bigint check (odoo_ubicacion_origen_id is null or odoo_ubicacion_origen_id > 0),
  odoo_ubicacion_transito_id bigint check (odoo_ubicacion_transito_id is null or odoo_ubicacion_transito_id > 0),
  odoo_ubicacion_destino_id bigint check (odoo_ubicacion_destino_id is null or odoo_ubicacion_destino_id > 0),
  odoo_compania_id bigint,
  unidad_notas text,

  es_prueba boolean not null default false,
  creado_por uuid references auth.users(id),
  creado_en timestamptz not null default now(),

  -- Exactamente 1 FK en condiciones normales; 0 FKs SOLO es valido cuando el
  -- origen ya fue borrado (origen_borrado_en sellado) -- es el estado final
  -- tras un ON DELETE SET NULL, no un vinculo mal formado.
  constraint odoo_vinculos_stock_una_fk_origen check (
    num_nonnulls(entrada_id, salida_id, conduce_externo_id, retiro_material_id, conteo_inventario_id) = 1
    or (num_nonnulls(entrada_id, salida_id, conduce_externo_id, retiro_material_id, conteo_inventario_id) = 0 and origen_borrado_en is not null)
  ),
  constraint odoo_vinculos_stock_compania_fk foreign key (odoo_instancia_id, odoo_compania_id)
    references sgc.odoo_companias(instancia_id, odoo_id)
);
comment on table sgc.odoo_vinculos_stock is 'CY4 -- vinculo documento SGC <-> documento Odoo (stock.picking/move/scrap). Cardinalidad N:N por diseno, nunca 1:1 forzado.';

-- Reintento no duplica: la MISMA pareja (doc Odoo, doc SGC, etapa) no se
-- repite. Relaciones multiples legitimas SI se permiten (mismo doc Odoo con
-- otro doc SGC = otra fila; mismo doc SGC con otra etapa = otra fila).
create unique index odoo_vinculos_stock_pareja_unica
  on sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, origen_sgc_tipo, origen_sgc_id);

create index odoo_vinculos_stock_por_origen on sgc.odoo_vinculos_stock (origen_sgc_tipo, origen_sgc_id);
create index odoo_vinculos_stock_por_odoo on sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id);

create or replace function sgc.odoo_v1_vinculo_stock_set_origen()
returns trigger
language plpgsql
as $fn$
begin
  if new.entrada_id is not null then new.origen_sgc_tipo := 'entrada'; new.origen_sgc_id := new.entrada_id;
  elsif new.salida_id is not null then new.origen_sgc_tipo := 'salida'; new.origen_sgc_id := new.salida_id;
  elsif new.conduce_externo_id is not null then new.origen_sgc_tipo := 'conduce_externo'; new.origen_sgc_id := new.conduce_externo_id;
  elsif new.retiro_material_id is not null then new.origen_sgc_tipo := 'retiro_material'; new.origen_sgc_id := new.retiro_material_id;
  elsif new.conteo_inventario_id is not null then new.origen_sgc_tipo := 'conteo_inventario'; new.origen_sgc_id := new.conteo_inventario_id;
  end if;
  return new;
end;
$fn$;
comment on function sgc.odoo_v1_vinculo_stock_set_origen is 'SGC Odoo foundation v1 (CY4)';

create trigger odoo_v1_vinculo_stock_set_origen
  before insert or update of entrada_id, salida_id, conduce_externo_id, retiro_material_id, conteo_inventario_id
  on sgc.odoo_vinculos_stock
  for each row execute function sgc.odoo_v1_vinculo_stock_set_origen();

-- Un origen borrado NO se reutiliza como activo: cuando el ON DELETE SET NULL
-- dispara, se conserva origen_sgc_tipo/id (ya quedaron fijos por la fila, no
-- se recalculan) y se sella origen_borrado_en. El trigger de arriba solo
-- corre en insert/update de las FKs; un DELETE en la tabla referenciada no
-- dispara ese trigger (es un UPDATE de la fila de vinculo poniendo la FK a
-- NULL), asi que lo marcamos aqui aparte.
create or replace function sgc.odoo_v1_vinculo_stock_marcar_borrado()
returns trigger
language plpgsql
as $fn$
begin
  if new.entrada_id is null and new.salida_id is null and new.conduce_externo_id is null
     and new.retiro_material_id is null and new.conteo_inventario_id is null
     and old.origen_borrado_en is null then
    new.origen_borrado_en := now();
  end if;
  return new;
end;
$fn$;
comment on function sgc.odoo_v1_vinculo_stock_marcar_borrado is 'SGC Odoo foundation v1 (CY4)';

create trigger odoo_v1_vinculo_stock_marcar_borrado
  before update of entrada_id, salida_id, conduce_externo_id, retiro_material_id, conteo_inventario_id
  on sgc.odoo_vinculos_stock
  for each row execute function sgc.odoo_v1_vinculo_stock_marcar_borrado();

-- ── Lineas ───────────────────────────────────────────────────────────────
-- Vinculo a nivel de renglon (detalle_entradas/detalle_salidas), para que una
-- recepcion dividida en Odoo (varias stock.move.line de un mismo picking)
-- pueda repartirse entre renglones SGC sin perder cantidades ni unidad.
create table sgc.odoo_vinculos_stock_lineas (
  id uuid primary key default gen_random_uuid(),
  vinculo_id uuid not null references sgc.odoo_vinculos_stock(id) on delete cascade,

  detalle_entrada_id uuid references sgc.detalle_entradas(id) on delete set null,
  detalle_salida_id uuid references sgc.detalle_salidas(id) on delete set null,
  origen_borrado_en timestamptz,

  odoo_move_line_id bigint check (odoo_move_line_id is null or odoo_move_line_id > 0),
  cantidad numeric,
  unidad text,

  creado_en timestamptz not null default now(),

  constraint odoo_vinculos_stock_lineas_una_fk check (
    num_nonnulls(detalle_entrada_id, detalle_salida_id) = 1
  )
);
comment on table sgc.odoo_vinculos_stock_lineas is 'CY4 -- renglon de odoo_vinculos_stock (detalle_entradas/detalle_salidas <-> stock.move.line).';

create unique index odoo_vinculos_stock_lineas_entrada_unica
  on sgc.odoo_vinculos_stock_lineas (vinculo_id, detalle_entrada_id) where detalle_entrada_id is not null;
create unique index odoo_vinculos_stock_lineas_salida_unica
  on sgc.odoo_vinculos_stock_lineas (vinculo_id, detalle_salida_id) where detalle_salida_id is not null;

create or replace function sgc.odoo_v1_vinculo_stock_linea_marcar_borrado()
returns trigger
language plpgsql
as $fn$
begin
  if new.detalle_entrada_id is null and new.detalle_salida_id is null and old.origen_borrado_en is null then
    new.origen_borrado_en := now();
  end if;
  return new;
end;
$fn$;
comment on function sgc.odoo_v1_vinculo_stock_linea_marcar_borrado is 'SGC Odoo foundation v1 (CY4)';

create trigger odoo_v1_vinculo_stock_linea_marcar_borrado
  before update of detalle_entrada_id, detalle_salida_id
  on sgc.odoo_vinculos_stock_lineas
  for each row execute function sgc.odoo_v1_vinculo_stock_linea_marcar_borrado();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Igual que las demas tablas de identidad Odoo (F5): sin acceso directo para
-- anon/authenticated. Lectura/escritura solo via RPC SECURITY DEFINER (a
-- construir cuando exista el adaptador que realmente escriba vinculos --
-- F9/F10) o service_role.
alter table sgc.odoo_vinculos_stock enable row level security;
alter table sgc.odoo_vinculos_stock_lineas enable row level security;

commit;
