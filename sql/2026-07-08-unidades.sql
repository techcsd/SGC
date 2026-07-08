-- SGC · Unidades de medida gestionables por admin (antes eran una constante
-- hardcodeada en articulo.model.ts). El formulario de artículos las lee desde
-- aquí; Administración → Unidades permite agregarlas/editarlas.
-- Apply: node scripts/apply-migration.mjs "<path>/2026-07-08-unidades.sql"

create table if not exists sgc.unidades (
  id          serial primary key,
  codigo      text not null unique,
  nombre      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed from the previous hardcoded list (idempotent).
insert into sgc.unidades (codigo, nombre) values
  ('unidad','Unidad'), ('par','Par'), ('docena','Docena'),
  ('kg','Kilogramo (kg)'), ('lb','Libra (lb)'), ('tonelada','Tonelada (t)'),
  ('m','Metro (m)'), ('m2','Metro cuadrado (m²)'), ('m3','Metro cúbico (m³)'),
  ('litro','Litro (L)'), ('galon','Galón'), ('saco','Saco'), ('bolsa','Bolsa'),
  ('rollo','Rollo'), ('tubo','Tubo'), ('barra','Barra'), ('varilla','Varilla'),
  ('plancha','Plancha'), ('lamina','Lámina'), ('bloque','Bloque'),
  ('quintal','Quintal (qq)'), ('pie','Pie'), ('pie2','Pie cuadrado (pie²)'),
  ('pie3','Pie cúbico (pie³)'), ('cubeta','Cubeta'), ('funda','Funda'),
  ('caja','Caja'), ('yarda','Yarda'), ('pulgada','Pulgada')
on conflict (codigo) do nothing;

alter table sgc.unidades enable row level security;

drop policy if exists "unidades_select" on sgc.unidades;
create policy "unidades_select" on sgc.unidades for select to authenticated using (true);

drop policy if exists "unidades_write" on sgc.unidades;
create policy "unidades_write" on sgc.unidades for all to authenticated
  using (sgc.is_admin()) with check (sgc.is_admin());

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.unidades to authenticated;
-- Serial PK sequence grant (recurring SGC gotcha: "permission denied for sequence").
grant usage, select on sequence sgc.unidades_id_seq to authenticated;

comment on table sgc.unidades is 'Catálogo de unidades de medida (gestionable por admin).';
