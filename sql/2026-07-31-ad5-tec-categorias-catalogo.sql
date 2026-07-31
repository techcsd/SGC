-- ============================================================================
-- AD5 — Ronda 31/07/2026 (PROMPT-15 FASE 2)
-- Homologación: mover las categorías de herramientas de un const hardcodeado
-- (TEC_CATEGORIAS en tecnologia.model.ts) a un catálogo administrable en BD, y
-- agregar categorías orientadas a ingeniería/construcción/oficina + seed de las
-- 6 herramientas de Xaviel. Todo aditivo e idempotente.
-- ============================================================================

create table if not exists sgc.tec_categorias (
  id         uuid primary key default gen_random_uuid(),
  clave      text not null unique,           -- se guarda en tec_herramientas.categoria
  label      text not null,
  orden      int  not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sgc.tec_categorias enable row level security;

drop policy if exists tec_cat_sel   on sgc.tec_categorias;
drop policy if exists tec_cat_write on sgc.tec_categorias;
create policy tec_cat_sel   on sgc.tec_categorias for select to authenticated using (true);
create policy tec_cat_write on sgc.tec_categorias for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));

grant select, insert, update, delete on sgc.tec_categorias to authenticated;

-- Seed de categorías (upsert por clave: no pisa 'activo' si un admin lo cambió,
-- pero mantiene el label/orden homologado). Incluye las claves legacy en uso
-- (ia, notas, nube, reuniones) para que las herramientas existentes conserven
-- su etiqueta.
insert into sgc.tec_categorias (clave, label, orden) values
  ('cad_dwg',          'CAD / DWG',                 10),
  ('takeoff',          'Mapeos / Take-off',         20),
  ('presupuestos',     'Presupuestos',              30),
  ('ofimatica',        'Ofimática',                 40),
  ('email',            'Email',                     50),
  ('calendarios',      'Calendarios',               60),
  ('videollamadas',    'Videollamadas',             70),
  ('mensajeria',       'Mensajería',                80),
  ('nube',             'Almacenamiento en la nube', 90),
  ('contabilidad_erp', 'Contabilidad / ERP',       100),
  ('diseno',           'Diseño',                   110),
  ('seguridad',        'Seguridad',                120),
  ('ia',               'IA / Asistentes',          130),
  -- legacy (conservan etiqueta para datos ya existentes)
  ('notas',            'Notas de reuniones',       200),
  ('reuniones',        'Reuniones',                210),
  ('comunicacion',     'Comunicación',             220),
  ('gestion',          'Gestión / Productividad',  230),
  ('desarrollo',       'Desarrollo',               240),
  ('otro',             'Otro',                     999)
on conflict (clave) do update
  set label = excluded.label, orden = excluded.orden, updated_at = now();

-- Seed de las 6 herramientas de Xaviel (idempotente por nombre, case-insensitive).
insert into sgc.tec_herramientas (nombre, categoria, para_que, quien_usa, url, activo, orden)
select v.nombre, v.categoria, v.para_que, v.quien_usa, v.url, true, v.orden
from (values
  ('AutoCAD',          'cad_dwg',       'Dibujo y planos técnicos en formato CAD/DWG.', 'Ingeniería / Arquitectura', 'https://www.autodesk.com/products/autocad', 10),
  ('Planswift 11',     'takeoff',       'Mediciones y cuantificación (take-off) sobre planos para presupuestos.', 'Presupuestos / Ingeniería', 'https://www.planswift.com', 20),
  ('Microsoft 365',    'ofimatica',     'Paquete de ofimática (Word, Excel, PowerPoint, etc.).', 'Toda la empresa', 'https://www.microsoft.com/microsoft-365', 30),
  ('Google Meet',      'videollamadas', 'Videollamadas y reuniones remotas.', 'Toda la empresa', 'https://meet.google.com', 40),
  ('Google Calendar',  'calendarios',   'Calendarios y agenda compartida.', 'Toda la empresa', 'https://calendar.google.com', 50),
  ('Gmail',            'email',         'Correo electrónico corporativo.', 'Toda la empresa', 'https://mail.google.com', 60)
) as v(nombre, categoria, para_que, quien_usa, url, orden)
where not exists (
  select 1 from sgc.tec_herramientas h where lower(h.nombre) = lower(v.nombre)
);
