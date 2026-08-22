-- AU4 — Locación estructurada de proyectos: cascada provincia → municipio → sector.
-- Reemplaza el texto libre de `ubicacion`/`zona` por campos estructurados para poder
-- SEGMENTAR (filtro del listado + dimensión de reportes) y escribir sin ambigüedad la
-- regla de zona de Wagner (AT18: Bávaro/Punta Cana). El link/coords sigue como está
-- (AM7 + parser AU16); esto lo COMPLEMENTA, no lo reemplaza. Aditivo/retrocompatible.

-- ── Catálogo de referencia (administrable) ───────────────────────────────────
create table if not exists sgc.provincias (
  id serial primary key,
  nombre text not null unique,
  activo boolean not null default true
);
create table if not exists sgc.municipios (
  id serial primary key,
  provincia_id int not null references sgc.provincias(id),
  nombre text not null,
  activo boolean not null default true,
  unique (provincia_id, nombre)
);
create table if not exists sgc.sectores (
  id serial primary key,
  municipio_id int not null references sgc.municipios(id),
  nombre text not null,
  activo boolean not null default true,
  created_by uuid references sgc.usuarios(id),
  created_at timestamptz not null default now(),
  unique (municipio_id, nombre)
);

alter table sgc.provincias enable row level security;
alter table sgc.municipios enable row level security;
alter table sgc.sectores  enable row level security;
grant select on sgc.provincias, sgc.municipios, sgc.sectores to authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sgc' and tablename='provincias' and policyname='provincias_sel') then
    create policy provincias_sel on sgc.provincias for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where schemaname='sgc' and tablename='municipios' and policyname='municipios_sel') then
    create policy municipios_sel on sgc.municipios for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where schemaname='sgc' and tablename='sectores' and policyname='sectores_sel') then
    create policy sectores_sel on sgc.sectores for select to authenticated using (true); end if;
end $$;

-- ── Columnas estructuradas en proyectos (nullable, aditivas) ─────────────────
alter table sgc.proyectos add column if not exists provincia_id int references sgc.provincias(id);
alter table sgc.proyectos add column if not exists municipio_id int references sgc.municipios(id);
alter table sgc.proyectos add column if not exists sector_id    int references sgc.sectores(id);

-- ── Seed: 32 provincias de RD ────────────────────────────────────────────────
insert into sgc.provincias (nombre) values
  ('Azua'),('Bahoruco'),('Barahona'),('Dajabón'),('Distrito Nacional'),('Duarte'),
  ('Elías Piña'),('El Seibo'),('Espaillat'),('Hato Mayor'),('Hermanas Mirabal'),
  ('Independencia'),('La Altagracia'),('La Romana'),('La Vega'),('María Trinidad Sánchez'),
  ('Monseñor Nouel'),('Monte Cristi'),('Monte Plata'),('Pedernales'),('Peravia'),
  ('Puerto Plata'),('Samaná'),('San Cristóbal'),('San José de Ocoa'),('San Juan'),
  ('San Pedro de Macorís'),('Santiago'),('Santiago Rodríguez'),('Santo Domingo'),
  ('Valverde'),('Sánchez Ramírez')
on conflict (nombre) do nothing;

-- ── Seed: municipios + sectores de las zonas donde CSD tiene obras hoy ────────
-- (el resto del país se agrega sobre la marcha con agregar_municipio/agregar_sector)
insert into sgc.municipios (provincia_id, nombre)
select p.id, m.nombre from sgc.provincias p
join (values
  ('La Altagracia','Higüey'), ('La Altagracia','San Rafael del Yuma'),
  ('Distrito Nacional','Distrito Nacional'),
  ('San Pedro de Macorís','San Pedro de Macorís'),
  ('Santo Domingo','Santo Domingo Este'), ('Santo Domingo','Santo Domingo Norte'),
  ('Santo Domingo','Santo Domingo Oeste'), ('Santo Domingo','Los Alcarrizos'),
  ('Santo Domingo','Boca Chica'), ('La Romana','La Romana')
) as m(prov, nombre) on m.prov = p.nombre
on conflict (provincia_id, nombre) do nothing;

insert into sgc.sectores (municipio_id, nombre)
select mu.id, s.nombre
from sgc.municipios mu
join sgc.provincias p on p.id = mu.provincia_id
join (values
  -- Higüey (zona este: la regla de Wagner AT18 vive acá)
  ('Higüey','Punta Cana'), ('Higüey','Bávaro'), ('Higüey','Verón'),
  ('Higüey','Cap Cana'), ('Higüey','Cana Bay'), ('Higüey','Vista Cana'),
  ('Higüey','Uvero Alto'), ('Higüey','Downtown Punta Cana'), ('Higüey','Higüey Centro'),
  -- Distrito Nacional
  ('Distrito Nacional','Piantini'), ('Distrito Nacional','Naco'),
  ('Distrito Nacional','Bella Vista'), ('Distrito Nacional','Gazcue'),
  ('Distrito Nacional','Los Cacicazgos'), ('Distrito Nacional','Ensanche Serrallés'),
  -- San Pedro
  ('San Pedro de Macorís','San Pedro Centro'), ('San Pedro de Macorís','Juan Dolio')
) as s(muni, nombre) on s.muni = mu.nombre
on conflict (municipio_id, nombre) do nothing;

-- ── RPCs de administración del catálogo (crear sobre la marcha) ──────────────
create or replace function sgc.agregar_municipio(p_provincia_id int, p_nombre text)
returns int language plpgsql security definer set search_path = sgc, public, pg_temp as $function$
declare v_id int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    raise exception 'No tienes permiso para agregar municipios.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El municipio no puede estar vacío.'; end if;
  insert into sgc.municipios (provincia_id, nombre) values (p_provincia_id, btrim(p_nombre))
  on conflict (provincia_id, nombre) do update set activo = true
  returning id into v_id;
  return v_id;
end; $function$;
grant execute on function sgc.agregar_municipio(int, text) to authenticated, service_role;

create or replace function sgc.agregar_sector(p_municipio_id int, p_nombre text)
returns int language plpgsql security definer set search_path = sgc, public, pg_temp as $function$
declare v_id int;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    raise exception 'No tienes permiso para agregar sectores.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El sector no puede estar vacío.'; end if;
  insert into sgc.sectores (municipio_id, nombre, created_by) values (p_municipio_id, btrim(p_nombre), auth.uid())
  on conflict (municipio_id, nombre) do update set activo = true
  returning id into v_id;
  return v_id;
end; $function$;
grant execute on function sgc.agregar_sector(int, text) to authenticated, service_role;
