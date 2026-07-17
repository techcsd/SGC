-- ============================================================================
-- Ronda 17/07/2026 — C1: categorías de licencia en formato dominicano (01,02…)
-- ----------------------------------------------------------------------------
-- Catálogo en BD (aditivo) que web y app consumen, en vez de hardcodear A..F.
-- Migra los valores viejos (A/B/C…) a su equivalente numérico RD. Idempotente.
-- Mapeo confirmado por el jefe (17/07/2026):
--   A->01  B->02  C->03  D->04  E->05  F->06
-- (En prod solo había 'B' y 'C' en uso -> quedan 02 y 03.)
-- ============================================================================

set search_path = sgc, public;

-- ── 1. Catálogo ─────────────────────────────────────────────────────────────
create table if not exists sgc.licencia_categorias (
  codigo     text primary key,               -- '01'..'06' (+ especiales)
  nombre     text not null,
  clase      text check (clase in ('Liviano', 'Pesado')),
  orden      int  not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed RD (upsert: refresca nombre/clase/orden sin borrar filas custom).
insert into sgc.licencia_categorias (codigo, nombre, clase, orden) values
  ('01', 'Motocicletas',                       'Liviano', 1),
  ('02', 'Vehículos livianos (auto/jeepeta)',  'Liviano', 2),
  ('03', 'Carga liviana / taxi',               'Liviano', 3),
  ('04', 'Autobuses / pasajeros',              'Pesado',  4),
  ('05', 'Carga pesada (camiones)',            'Pesado',  5),
  ('06', 'Vehículos especiales / maquinaria',  'Pesado',  6)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      clase  = excluded.clase,
      orden  = excluded.orden;

alter table sgc.licencia_categorias enable row level security;

drop policy if exists licencia_categorias_sel on sgc.licencia_categorias;
create policy licencia_categorias_sel on sgc.licencia_categorias for select to authenticated
  using (true);

drop policy if exists licencia_categorias_write on sgc.licencia_categorias;
create policy licencia_categorias_write on sgc.licencia_categorias for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

grant select on sgc.licencia_categorias to authenticated;
grant all on sgc.licencia_categorias to service_role;

-- ── 2. Migración de datos: A/B/C… -> 0X ─────────────────────────────────────
-- Solo toca filas que aún tienen el formato viejo (una sola letra A-F), así que
-- re-ejecutar no revierte nada ya migrado.
update sgc.conductores set licencia_tipo = case licencia_tipo
    when 'A' then '01'
    when 'B' then '02'
    when 'C' then '03'
    when 'D' then '04'
    when 'E' then '05'
    when 'F' then '06'
  end
where licencia_tipo in ('A', 'B', 'C', 'D', 'E', 'F');

-- Nota: no se añade FK conductores.licencia_tipo -> licencia_categorias.codigo
-- para no romper filas con códigos históricos/no catalogados; el front valida
-- contra el catálogo y muestra el código crudo si no está listado.
