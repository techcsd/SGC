-- ════════════════════════════════════════════════════════════════════════════
-- AV7 — Map-matching: caché de polylines "pegadas a la calle" (snapToRoads)
-- ════════════════════════════════════════════════════════════════════════════
-- La edge function `snap-to-roads` recibe un tramo de coordenadas crudas, lo
-- matchea contra las calles con Google Roads API y CACHEA el resultado por hash
-- de contenido: un tramo consolidado es inmutable → se paga el match UNA sola vez.
-- Los puntos crudos NO se tocan (chofer_posiciones intacta); el snap es capa de
-- presentación. Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists sgc.snap_cache (
  cache_key  text primary key,           -- md5(coords normalizadas) — inmutable por contenido
  snapped    jsonb not null,             -- [[lat,lng],...] ya pegado a la calle
  puntos_in  int,
  puntos_out int,
  created_at timestamptz not null default now()
);
comment on table sgc.snap_cache is
  'AV7 — caché de map-matching (snapToRoads) por hash de contenido del tramo. Se paga el match una sola vez; el resultado se reusa en recorrido diario, replay y seguimiento.';

alter table sgc.snap_cache enable row level security;
-- Sólo la edge function (service_role) lee/escribe; el frontend consume vía la edge.
grant select, insert on sgc.snap_cache to service_role;
