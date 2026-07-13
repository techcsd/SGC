-- Mejoras de Flota: origen geo de rutas (auto distancia/tiempo), fotos de vehículos
-- y de mantenimientos.
set search_path = sgc, public;

alter table sgc.rutas
  add column if not exists origen_lat numeric,
  add column if not exists origen_lng numeric;

alter table sgc.vehiculos      add column if not exists fotos text[] not null default '{}';
alter table sgc.mantenimientos add column if not exists fotos text[] not null default '{}';
comment on column sgc.vehiculos.fotos is 'Rutas de fotos del vehículo en el bucket "vehiculos".';
comment on column sgc.mantenimientos.fotos is 'Rutas de fotos del mantenimiento en el bucket "vehiculos".';
