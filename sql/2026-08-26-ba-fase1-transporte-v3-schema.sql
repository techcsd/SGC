-- ============================================================================
-- BA / TRANSPORTE V3 — FASE 1 — Esquema base (aditivo, retrocompatible).
-- Fuente de verdad: TRANSPORTE-V3-DECISIONES.md (§01-04) + FASE 0 aprobada por Xaviel.
--
-- Este archivo SOLO crea tablas/columnas/índices/RLS/grants. NO cambia ningún
-- flujo existente (el retiro del conduce automático de AT7 y los RPCs de escritura
-- viven en FASE 2/3). El parámetro `requisicion_auto_conduce` nace en 'true' para
-- preservar el comportamiento actual hasta que la UI de despachos esté lista.
--
-- Modelo (decisión de arquitectura — regla 7):
--  · Conduce externo = documento de transporte propio (`conduces_externos`), NO un
--    flag sobre `salidas_inventario` (cuyo `bodega_id` es NOT NULL y no admite carga
--    no-inventario tipo "una nevera"). Puede opcionalmente enlazar una salida (sale
--    de nuestro almacén) o una entrada (entra a nuestro almacén) para el impacto de
--    inventario; o ninguna (carga neutra, descripción libre).
--  · Proveedores de transportación = catálogo propio (`proveedores_transporte`),
--    separado de `sgc.proveedores` (suplidores de material/ferreterías) por tener
--    workflow de ratificación y pago por viaje.
--  · «Otros» en lugares = texto plano (ya soportado en rutas/salidas) + bandeja
--    dedicada (`lugares_por_registrar`) + catálogo de POIs promovidos
--    (`lugares_registrados`) que el buscador (FASE 4) unirá con obras y almacenes.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ---------------------------------------------------------------------------
-- (1) Proveedores de transportación — catálogo con ratificación
-- ---------------------------------------------------------------------------
create table if not exists sgc.proveedores_transporte (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  telefono       text,
  contacto       text,
  rnc            text,
  notas          text,
  estado         text not null default 'sin_ratificar'
                   check (estado in ('sin_ratificar', 'ratificado')),
  ratificado_por uuid references sgc.usuarios(id),
  ratificado_en  timestamptz,
  activo         boolean not null default true,
  creado_por     uuid not null default auth.uid() references sgc.usuarios(id),
  created_at     timestamptz not null default now(),
  es_prueba      boolean not null default false,
  es_prueba_origen text
);
create index if not exists idx_prov_transporte_estado on sgc.proveedores_transporte (estado) where activo;
create index if not exists idx_prov_transporte_nombre on sgc.proveedores_transporte (lower(nombre));

alter table sgc.proveedores_transporte enable row level security;
drop policy if exists prov_transporte_select on sgc.proveedores_transporte;
create policy prov_transporte_select on sgc.proveedores_transporte
  for select using (true);   -- catálogo; el filtrado es_prueba se hace en RPC/consultas
grant select on sgc.proveedores_transporte to authenticated;
-- Escrituras: SOLO vía RPC SECURITY DEFINER (FASE 2). No se otorga DML directo.

comment on table sgc.proveedores_transporte is
  'BA/Transporte v3 — proveedores de transportación (camiones de terceros). Nunca acceden al sistema; data interna. Nace sin_ratificar; Raykler ratifica.';

-- ---------------------------------------------------------------------------
-- (2) Conduces externos — documento de transporte de un tercero
-- ---------------------------------------------------------------------------
create table if not exists sgc.conduces_externos (
  id                   uuid primary key default gen_random_uuid(),
  -- Quién transporta (proveedor formal o texto «Otro»)
  transporta_proveedor_id uuid references sgc.proveedores_transporte(id),
  transporta_texto        text,
  -- Fotos obligatorias (placa + carga; en 1 o 2 fotos — política AS15)
  placa_foto_path      text not null,
  carga_foto_path      text,
  -- Material: items del catálogo (vía salida/entrada enlazada) o descripción libre
  material_descripcion text,
  afecta_inventario    boolean not null default false,
  salida_id            uuid references sgc.salidas_inventario(id),   -- sale de nuestro almacén
  entrada_id           uuid references sgc.entradas_inventario(id),  -- entra a nuestro almacén
  -- Origen → destino (obra/almacén/coords, o texto «Otros» sin coordenadas)
  origen               text,
  origen_lat           numeric,
  origen_lng           numeric,
  origen_proyecto_id   uuid references sgc.proyectos(id),
  origen_bodega_id     uuid references sgc.bodegas(id),
  destino              text,
  destino_lat          numeric,
  destino_lng          numeric,
  destino_proyecto_id  uuid references sgc.proyectos(id),
  destino_bodega_id    uuid references sgc.bodegas(id),
  -- Estado + firmas (FASE 0.4: emisor = quien recibe el camión; receptor = destino)
  estado               text not null default 'emitido'
                         check (estado in ('emitido', 'recibido', 'anulado')),
  emisor_usuario_id    uuid not null default auth.uid() references sgc.usuarios(id),
  emisor_firma_path    text,
  recibido_por         uuid references sgc.usuarios(id),
  recibido_en          timestamptz,
  recepcion_foto_path  text,
  receptor_firma_path  text,
  notas_recepcion      text,
  -- Como despacho de una requisición (FASE 3)
  origen_requisicion_id uuid references sgc.solicitudes_material(id),
  notas                text,
  anulado_por          uuid references sgc.usuarios(id),
  anulado_en           timestamptz,
  motivo_anulacion     text,
  creado_por           uuid not null default auth.uid() references sgc.usuarios(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  es_prueba            boolean not null default false,
  es_prueba_origen     text,
  -- Debe indicar quién transporta por alguna de las dos vías
  constraint conduce_ext_transporta_chk
    check (transporta_proveedor_id is not null or nullif(btrim(transporta_texto), '') is not null)
);
create index if not exists idx_conduce_ext_proveedor on sgc.conduces_externos (transporta_proveedor_id);
create index if not exists idx_conduce_ext_estado on sgc.conduces_externos (estado);
create index if not exists idx_conduce_ext_requisicion on sgc.conduces_externos (origen_requisicion_id);
create index if not exists idx_conduce_ext_created on sgc.conduces_externos (created_at desc);

alter table sgc.conduces_externos enable row level security;
drop policy if exists conduce_ext_select on sgc.conduces_externos;
create policy conduce_ext_select on sgc.conduces_externos
  for select using (true);   -- aparece en el historial general; filtrado en consultas
grant select on sgc.conduces_externos to authenticated;

comment on table sgc.conduces_externos is
  'BA/Transporte v3 — conduce externo: transporta un proveedor. Emisor = quien recibe el camión; receptor = destino (matriz AY2). Impacto de inventario opcional vía salida_id/entrada_id.';

-- ---------------------------------------------------------------------------
-- (3) Viajes de transportación — uno por conduce externo (tracking + pago)
-- ---------------------------------------------------------------------------
create table if not exists sgc.viajes_transporte (
  id                 uuid primary key default gen_random_uuid(),
  proveedor_id       uuid references sgc.proveedores_transporte(id),
  proveedor_texto    text,   -- «Otro» a mano (se puede absorber luego a un proveedor formal)
  conduce_externo_id uuid references sgc.conduces_externos(id) on delete cascade,
  fecha              date not null default current_date,
  estado_pago        text not null default 'pendiente_pago'
                       check (estado_pago in ('pendiente_pago', 'pagado')),
  pagado_por         uuid references sgc.usuarios(id),
  pagado_en          timestamptz,
  notas              text,
  creado_por         uuid not null default auth.uid() references sgc.usuarios(id),
  created_at         timestamptz not null default now(),
  es_prueba          boolean not null default false,
  es_prueba_origen   text,
  constraint viaje_proveedor_chk
    check (proveedor_id is not null or nullif(btrim(proveedor_texto), '') is not null)
);
create index if not exists idx_viaje_proveedor on sgc.viajes_transporte (proveedor_id);
create index if not exists idx_viaje_estado_pago on sgc.viajes_transporte (estado_pago);
create index if not exists idx_viaje_fecha on sgc.viajes_transporte (fecha desc);
create index if not exists idx_viaje_conduce on sgc.viajes_transporte (conduce_externo_id);

alter table sgc.viajes_transporte enable row level security;
drop policy if exists viaje_transporte_select on sgc.viajes_transporte;
create policy viaje_transporte_select on sgc.viajes_transporte
  for select using (true);
grant select on sgc.viajes_transporte to authenticated;

comment on table sgc.viajes_transporte is
  'BA/Transporte v3 — un viaje por conduce externo. Estado de pago (pendiente/pagado) — solo Raykler marca pagado; los montos viven en Odoo, no aquí.';

-- ---------------------------------------------------------------------------
-- (4) Lugares registrados (POIs) — catálogo que alimenta el buscador (FASE 4)
--     Aquí caen los «Otros» promovidos desde la bandeja (con coordenadas).
-- ---------------------------------------------------------------------------
create table if not exists sgc.lugares_registrados (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  lat        numeric,
  lng        numeric,
  tipo       text not null default 'poi',   -- 'poi' (promovido) | otros futuros
  notas      text,
  activo     boolean not null default true,
  creado_por uuid not null default auth.uid() references sgc.usuarios(id),
  created_at timestamptz not null default now(),
  es_prueba  boolean not null default false,
  es_prueba_origen text
);
create index if not exists idx_lugares_reg_nombre on sgc.lugares_registrados (lower(nombre)) where activo;

alter table sgc.lugares_registrados enable row level security;
drop policy if exists lugares_reg_select on sgc.lugares_registrados;
create policy lugares_reg_select on sgc.lugares_registrados
  for select using (true);
grant select on sgc.lugares_registrados to authenticated;

comment on table sgc.lugares_registrados is
  'BA/Transporte v3 — POIs registrados (lugares promovidos desde «Otros»). El buscador (FASE 4) los une con obras y almacenes.';

-- ---------------------------------------------------------------------------
-- (5) Lugares por registrar — bandeja dedicada de Raykler para cada «Otros»
-- ---------------------------------------------------------------------------
create table if not exists sgc.lugares_por_registrar (
  id                 uuid primary key default gen_random_uuid(),
  texto              text not null,                 -- lo que el usuario escribió ("Bellón")
  usado_por          uuid not null default auth.uid() references sgc.usuarios(id),
  documento_tipo     text,                          -- 'conduce' | 'conduce_externo' | 'ruta' | 'salida'
  documento_id       uuid,
  contexto           text,                          -- 'origen' | 'destino'
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'promovido', 'descartado')),
  promovido_a_lugar_id uuid references sgc.lugares_registrados(id),
  promovido_por      uuid references sgc.usuarios(id),
  promovido_en       timestamptz,
  created_at         timestamptz not null default now(),
  es_prueba          boolean not null default false,
  es_prueba_origen   text
);
create index if not exists idx_lugares_pend_estado on sgc.lugares_por_registrar (estado, created_at desc);
create index if not exists idx_lugares_pend_texto on sgc.lugares_por_registrar (lower(texto));

alter table sgc.lugares_por_registrar enable row level security;
drop policy if exists lugares_pend_select on sgc.lugares_por_registrar;
create policy lugares_pend_select on sgc.lugares_por_registrar
  for select using (true);   -- la bandeja se gatea por módulo en UI/RPC
grant select on sgc.lugares_por_registrar to authenticated;

comment on table sgc.lugares_por_registrar is
  'BA/Transporte v3 — bandeja «Lugares por registrar»: cada «Otros» textual cae aquí para que Raykler lo promueva a lugar registrado (con coordenadas).';

-- ---------------------------------------------------------------------------
-- (6) Columnas aditivas para DESPACHOS (FASE 3) y movimientos flexibles
-- ---------------------------------------------------------------------------
-- Conduce (salida) generado desde una requisición — enlace inverso (Q5).
alter table sgc.salidas_inventario add column if not exists origen_requisicion_id uuid references sgc.solicitudes_material(id);
comment on column sgc.salidas_inventario.origen_requisicion_id is
  'BA/Transporte v3 — requisición de la que salió este conduce (despacho). Muchos conduces por requisición.';
create index if not exists idx_salidas_origen_requisicion on sgc.salidas_inventario (origen_requisicion_id);

-- Salida a un lugar «Otros» (texto) o sin destino de obra nuestra (aclaración 2).
alter table sgc.salidas_inventario add column if not exists destino_texto text;
comment on column sgc.salidas_inventario.destino_texto is
  'BA/Transporte v3 — destino en texto libre («Otros») cuando no es obra/almacén nuestro; sin coordenadas.';

-- Backfill del origen de los conduces automáticos históricos (Q5): dejarlos
-- vinculados a su requisición como despachos históricos, sin cambiar nada más.
update sgc.salidas_inventario si
   set origen_requisicion_id = sm.id
  from sgc.solicitudes_material sm
 where sm.salida_id = si.id
   and si.origen_requisicion_id is null;

-- Entrada desde un origen «Otros» (proveedor no habitual / lugar texto) (aclaración 2).
alter table sgc.entradas_inventario add column if not exists origen_texto text;
comment on column sgc.entradas_inventario.origen_texto is
  'BA/Transporte v3 — origen en texto libre («Otros») para entradas que no vienen de la ferretería habitual.';

-- Requisición: cierre/cancelación manual por rol (FASE 3) con motivo e histórico.
alter table sgc.solicitudes_material add column if not exists cancelada_motivo text;
alter table sgc.solicitudes_material add column if not exists cerrada_por uuid references sgc.usuarios(id);
alter table sgc.solicitudes_material add column if not exists cerrada_en timestamptz;
comment on column sgc.solicitudes_material.cancelada_motivo is
  'BA/Transporte v3 — motivo obligatorio al cancelar sin despachar todo. Histórico intacto.';

-- ---------------------------------------------------------------------------
-- (7) Flag de transición: retiro del conduce automático al aprobar (AT7 → FASE 3)
--     Nace en 'true' = comportamiento actual sin cambios. FASE 3 lo apaga.
-- ---------------------------------------------------------------------------
insert into sgc.parametros (clave, valor, descripcion, updated_at)
values ('requisicion_auto_conduce', 'true',
        'BA/Transporte v3 — si "true", aprobar una requisición genera el conduce (salida) automáticamente (comportamiento AT7 legado). Si "false", la requisición queda "por despachar" y el conduce se emite como despacho manual. FASE 3 lo apaga.',
        now())
on conflict (clave) do nothing;

commit;
