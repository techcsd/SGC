-- =============================================================================
-- PROMPT-3 FASE 2 (AL1) — Inventario tecnológico completo. SGC padre.
-- Aditivo, idempotente, retrocompatible.
--
-- El módulo "Tecnología" actual se DIVIDE en la web (decisión Xaviel):
--   • Plataforma/DevOps (versiones, QA, monitoreo, reportes de errores) → "Sistema".
--   • Activos de TI (guía, homologación, matriz, INVENTARIO, compras) → "Tecnología"
--     real, con gating por módulo `tecnologia` + admin.
-- Esta migración es la parte de BD del Inventario tecnológico:
--   (a) catálogo de TIPOS administrable (CRUD) — antes texto hardcodeado;
--   (b) UBICACIÓN por bodega (dropdown almacenes + Bodega/Oficina Central);
--   (c) PRECIO con MONEDA (USD | DOP);
--   (d) MULTI-FOTOS con PORTADA (antes foto única).
-- =============================================================================

begin;

-- ── AL1.a — Catálogo administrable de tipos de equipo tecnológico ────────────
create table if not exists sgc.tec_equipo_tipos (
  id         uuid primary key default gen_random_uuid(),
  clave      text unique not null,
  label      text not null,
  orden      int not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed (set estándar de oficina + equipos de obra/campo). Idempotente por clave.
insert into sgc.tec_equipo_tipos (clave, label, orden) values
  ('walkie_talkie', 'Walkie-talkie',        10),
  ('laptop',        'Laptop',                20),
  ('desktop',       'Desktop / PC',          30),
  ('monitor',       'Monitor',               40),
  ('impresora',     'Impresora',             50),
  ('router',        'Router / Módem',        60),
  ('telefono',      'Teléfono / Celular',    70),
  ('tablet',        'Tablet',                80),
  ('camara',        'Cámara / CCTV',         90),
  ('ups',           'UPS',                  100),
  ('proyector',     'Proyector',            110),
  ('gps',           'GPS / Estación total', 120),
  ('radio_base',    'Radio base',           130),
  ('drone',         'Drone',                140),
  ('nivel_laser',   'Nivel láser',          150),
  ('accesorio',     'Accesorio',            160),
  ('otro',          'Otro',                 900)
on conflict (clave) do nothing;

alter table sgc.tec_equipo_tipos enable row level security;
drop policy if exists tec_equipo_tipos_sel on sgc.tec_equipo_tipos;
create policy tec_equipo_tipos_sel on sgc.tec_equipo_tipos
  for select to authenticated using (true);
drop policy if exists tec_equipo_tipos_ins on sgc.tec_equipo_tipos;
create policy tec_equipo_tipos_ins on sgc.tec_equipo_tipos
  for insert to authenticated with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));
drop policy if exists tec_equipo_tipos_upd on sgc.tec_equipo_tipos;
create policy tec_equipo_tipos_upd on sgc.tec_equipo_tipos
  for update to authenticated using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));
grant select, insert, update on sgc.tec_equipo_tipos to authenticated;

-- ── AL1.b/c/d — Columnas nuevas en tec_equipos ───────────────────────────────
alter table sgc.tec_equipos
  add column if not exists tipo_id       uuid references sgc.tec_equipo_tipos(id) on delete set null,
  add column if not exists bodega_id     uuid references sgc.bodegas(id) on delete set null,
  add column if not exists moneda        text not null default 'DOP',
  add column if not exists fotos         text[] not null default '{}',
  add column if not exists foto_portada  text;

alter table sgc.tec_equipos drop constraint if exists tec_equipos_moneda_chk;
alter table sgc.tec_equipos add constraint tec_equipos_moneda_chk
  check (moneda in ('DOP','USD'));

comment on column sgc.tec_equipos.tipo_id      is 'AL1 — tipo del catálogo administrable (tec_equipo_tipos). `tipo` (texto legacy) se conserva como fallback.';
comment on column sgc.tec_equipos.bodega_id    is 'AL1 — ubicación por almacén (bodegas). `ubicacion` (texto libre legacy) se conserva.';
comment on column sgc.tec_equipos.moneda       is 'AL1 — moneda del costo: DOP | USD.';
comment on column sgc.tec_equipos.fotos        is 'AL1 — galería multi-foto (paths). Retrocompat: foto_path se migra a fotos[0]/portada.';
comment on column sgc.tec_equipos.foto_portada is 'AL1 — path de la foto de portada (fallback: fotos[0] o foto_path).';

-- ── AL1 — Backfill retrocompatible ───────────────────────────────────────────
-- (1) foto única -> galería + portada.
update sgc.tec_equipos
   set fotos = array[foto_path],
       foto_portada = coalesce(foto_portada, foto_path)
 where foto_path is not null
   and (fotos is null or array_length(fotos,1) is null);

-- (2) tipo texto legacy -> tipo_id del catálogo (map por clave equivalente).
update sgc.tec_equipos e
   set tipo_id = t.id
  from sgc.tec_equipo_tipos t
 where e.tipo_id is null
   and t.clave = case lower(coalesce(e.tipo,''))
                   when 'red' then 'router'
                   when 'celular' then 'telefono'
                   else lower(coalesce(e.tipo,'otro'))
                 end;
-- Los que no mapearon quedan en 'otro'.
update sgc.tec_equipos e
   set tipo_id = (select id from sgc.tec_equipo_tipos where clave = 'otro')
 where e.tipo_id is null;

commit;
