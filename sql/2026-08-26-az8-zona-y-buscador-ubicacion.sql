-- AZ8 — Capa ZONA/REGIÓN sobre el catálogo de ubicaciones + buscador con autocompletado.
-- El catálogo de provincias/municipios/sectores ya existe (AU4). Aquí:
--  (1) agregamos la zona a cada provincia (partición de la empresa: Este / Cibao / Sur / Gran Santo Domingo),
--  (2) derivamos la zona del proyecto desde su provincia (backfill, override manual permitido),
--  (3) un buscador único (unaccent) sobre todo el catálogo — "punta cana" encuentra el sector y su cadena.
-- Aditivo y retrocompatible.

-- (unaccent ya está instalado en el schema `extensions`.)

-- (1) Zona por provincia -----------------------------------------------------
alter table sgc.provincias add column if not exists zona text;

-- Gran Santo Domingo
update sgc.provincias set zona = 'Gran Santo Domingo' where id in (5, 30);
-- Este (Yuma + Higuamo)
update sgc.provincias set zona = 'Este' where id in (13, 14, 8, 10, 27, 19);
-- Sur (Valdesia + El Valle + Enriquillo)
update sgc.provincias set zona = 'Sur' where id in (1, 2, 3, 7, 12, 20, 21, 24, 25, 26);
-- Cibao (Norte: Cibao Norte/Sur/Nordeste/Noroeste)
update sgc.provincias set zona = 'Cibao' where id in (4, 6, 9, 11, 15, 16, 17, 18, 22, 23, 28, 29, 31, 32);

-- (2) Derivar la zona del proyecto desde la provincia (solo donde falta) -------
update sgc.proyectos pr
   set zona = p.zona
  from sgc.provincias p
 where pr.provincia_id = p.id
   and p.zona is not null
   and (pr.zona is null or btrim(pr.zona) = '');

-- (3) Buscador de ubicación con autocompletado --------------------------------
-- Devuelve coincidencias en sectores/municipios/provincias con su cadena completa,
-- para rellenar provincia_id/municipio_id/sector_id de un tirón. Sectores primero.
create or replace function sgc.buscar_ubicacion(p_q text)
returns table(
  nivel text, label text, zona text,
  provincia_id int, provincia text,
  municipio_id int, municipio text,
  sector_id int, sector text
)
language sql
stable
security definer
set search_path to 'sgc', 'public', 'extensions', 'pg_temp'
as $$
  with q as (select extensions.unaccent(lower(btrim(coalesce(p_q, '')))) as t)
  select nivel, label, zona, provincia_id, provincia, municipio_id, municipio, sector_id, sector
  from (
    -- Sectores (más específico)
    select 0 as ord, 'sector'::text as nivel,
           s.nombre || ' — ' || m.nombre || ', ' || p.nombre as label, p.zona,
           p.id as provincia_id, p.nombre as provincia,
           m.id as municipio_id, m.nombre as municipio,
           s.id as sector_id, s.nombre as sector
      from sgc.sectores s
      join sgc.municipios m on m.id = s.municipio_id
      join sgc.provincias p on p.id = m.provincia_id
     where s.activo
       and (select length(t) from q) >= 2
       and extensions.unaccent(lower(s.nombre)) like '%' || (select t from q) || '%'
    union all
    -- Municipios
    select 1, 'municipio', m.nombre || ', ' || p.nombre, p.zona,
           p.id, p.nombre, m.id, m.nombre, null::int, null::text
      from sgc.municipios m
      join sgc.provincias p on p.id = m.provincia_id
     where m.activo
       and (select length(t) from q) >= 2
       and extensions.unaccent(lower(m.nombre)) like '%' || (select t from q) || '%'
    union all
    -- Provincias
    select 2, 'provincia', p.nombre, p.zona,
           p.id, p.nombre, null::int, null::text, null::int, null::text
      from sgc.provincias p
     where p.activo
       and (select length(t) from q) >= 2
       and extensions.unaccent(lower(p.nombre)) like '%' || (select t from q) || '%'
  ) x
  order by ord, label
  limit 25;
$$;

grant execute on function sgc.buscar_ubicacion(text) to authenticated;
