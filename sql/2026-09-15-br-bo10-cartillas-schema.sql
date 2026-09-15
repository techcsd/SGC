-- BO10 (§E, re-pegada ×6) — CARTILLAS de acero v1. Nota #8: "Implementar el flujo de
-- las cartillas… Guilamo registra… le llegue a Ramón… reportes, historial, atadas al
-- ingeniero y la obra… la fecha a según él entienda, no en real time."
--
-- v1 = el modelo de docs/CARTILLAS-PROPUESTA.md tal cual (DEFAULT, Regla A). Catálogos
-- administrables (diámetros/figuras) para que Guilamo/Ramón ajusten sin código.
-- BC7: RLS desde el nacimiento; escritura solo por RPC (SECURITY DEFINER).

begin;

-- 1) Catálogos administrables --------------------------------------------------
create table if not exists sgc.acero_diametros (
  codigo text primary key,           -- '3/8"', '1/2"', ...
  mm numeric,
  kg_por_m numeric not null,
  activo boolean not null default true,
  orden int not null default 0
);
insert into sgc.acero_diametros (codigo, mm, kg_por_m, orden) values
  ('3/8"', 9.5, 0.560, 1), ('1/2"', 12.7, 0.994, 2), ('5/8"', 15.9, 1.552, 3),
  ('3/4"', 19.1, 2.235, 4), ('1"', 25.4, 3.973, 5)
on conflict (codigo) do nothing;

create table if not exists sgc.cartilla_figuras (
  codigo text primary key,
  nombre text not null,
  svg text,
  activo boolean not null default true,
  orden int not null default 0
);
insert into sgc.cartilla_figuras (codigo, nombre, orden) values
  ('recta', 'Recta', 1), ('l', 'L', 2), ('u', 'U', 3),
  ('estribo', 'Estribo', 4), ('gancho', 'Gancho', 5), ('z', 'Z', 6)
on conflict (codigo) do nothing;

-- 2) Cartillas + hijos ---------------------------------------------------------
create sequence if not exists sgc.cartilla_folio_seq;

create table if not exists sgc.cartillas (
  id uuid primary key default gen_random_uuid(),
  folio text unique,
  proyecto_id uuid not null references sgc.proyectos(id),
  ingeniero_id uuid not null default auth.uid() references sgc.usuarios(id),
  fecha date not null default current_date,          -- BL9: elegible (no real-time)
  capturado_en timestamptz not null default now(),
  plano_path text,
  estado text not null default 'borrador'
    check (estado in ('borrador','enviada','revisada','observada','ejecutada')),
  observacion text,
  notas text,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartillas_proyecto on sgc.cartillas(proyecto_id);
create index if not exists idx_cartillas_ingeniero on sgc.cartillas(ingeniero_id);

create table if not exists sgc.cartilla_atados (
  id uuid primary key default gen_random_uuid(),
  cartilla_id uuid not null references sgc.cartillas(id) on delete cascade,
  identificador text,
  elemento text,
  cantidad_piezas int,
  orden int not null default 0
);
create index if not exists idx_cartilla_atados_cartilla on sgc.cartilla_atados(cartilla_id);

create table if not exists sgc.cartilla_piezas (
  id uuid primary key default gen_random_uuid(),
  atado_id uuid not null references sgc.cartilla_atados(id) on delete cascade,
  marca text,
  diametro_codigo text references sgc.acero_diametros(codigo),
  figura_codigo text references sgc.cartilla_figuras(codigo),
  tramos_cm jsonb,                 -- [{lado, cm}]
  longitud_total_cm numeric,
  cantidad int not null default 1,
  peso_kg numeric,
  orden int not null default 0
);
create index if not exists idx_cartilla_piezas_atado on sgc.cartilla_piezas(atado_id);

create table if not exists sgc.cartilla_fotos (
  id uuid primary key default gen_random_uuid(),
  cartilla_id uuid not null references sgc.cartillas(id) on delete cascade,
  path text not null,
  orden int not null default 0
);

create table if not exists sgc.cartilla_eventos (
  id uuid primary key default gen_random_uuid(),
  cartilla_id uuid not null references sgc.cartillas(id) on delete cascade,
  estado_desde text,
  estado_hasta text,
  usuario_id uuid references sgc.usuarios(id),
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cartilla_eventos_cartilla on sgc.cartilla_eventos(cartilla_id);

-- 3) Folio 'CAR-' + es_prueba heredado de la obra (triggers DEFINER) -----------
create or replace function sgc.tg_cartilla_before_insert()
returns trigger language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if new.folio is null then
    new.folio := 'CAR-' || lpad(nextval('sgc.cartilla_folio_seq')::text, 6, '0');
  end if;
  -- es_prueba hereda del proyecto (no se puede falsear desde el cliente).
  select coalesce(es_prueba, false) into new.es_prueba from sgc.proyectos where id = new.proyecto_id;
  return new;
end $$;
drop trigger if exists trg_cartilla_before_insert on sgc.cartillas;
create trigger trg_cartilla_before_insert before insert on sgc.cartillas
  for each row execute function sgc.tg_cartilla_before_insert();

-- 4) RLS (BC7) — lectura por visibilidad de obra; escritura solo por RPC ---------
alter table sgc.acero_diametros enable row level security;
alter table sgc.cartilla_figuras enable row level security;
alter table sgc.cartillas enable row level security;
alter table sgc.cartilla_atados enable row level security;
alter table sgc.cartilla_piezas enable row level security;
alter table sgc.cartilla_fotos enable row level security;
alter table sgc.cartilla_eventos enable row level security;

-- catálogos: lectura a todo autenticado.
drop policy if exists cat_diam_sel on sgc.acero_diametros;
create policy cat_diam_sel on sgc.acero_diametros for select to authenticated using (true);
drop policy if exists cat_fig_sel on sgc.cartilla_figuras;
create policy cat_fig_sel on sgc.cartilla_figuras for select to authenticated using (true);

-- predicado de visibilidad de una cartilla.
create or replace function sgc.puede_ver_cartilla(p_proyecto_id uuid, p_ingeniero_id uuid)
returns boolean language sql stable set search_path to 'sgc','pg_temp' as $$
  select sgc.is_admin()
      or p_ingeniero_id = auth.uid()
      or sgc.tiene_modulo('bitacora')
      or sgc.es_responsable_de_proyecto(p_proyecto_id, auth.uid());
$$;

drop policy if exists cartillas_sel on sgc.cartillas;
create policy cartillas_sel on sgc.cartillas for select to authenticated
  using (sgc.puede_ver_cartilla(proyecto_id, ingeniero_id));

drop policy if exists cartilla_atados_sel on sgc.cartilla_atados;
create policy cartilla_atados_sel on sgc.cartilla_atados for select to authenticated
  using (exists (select 1 from sgc.cartillas c where c.id = cartilla_id and sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)));

drop policy if exists cartilla_piezas_sel on sgc.cartilla_piezas;
create policy cartilla_piezas_sel on sgc.cartilla_piezas for select to authenticated
  using (exists (select 1 from sgc.cartilla_atados a join sgc.cartillas c on c.id = a.cartilla_id
                 where a.id = atado_id and sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)));

drop policy if exists cartilla_fotos_sel on sgc.cartilla_fotos;
create policy cartilla_fotos_sel on sgc.cartilla_fotos for select to authenticated
  using (exists (select 1 from sgc.cartillas c where c.id = cartilla_id and sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)));

drop policy if exists cartilla_eventos_sel on sgc.cartilla_eventos;
create policy cartilla_eventos_sel on sgc.cartilla_eventos for select to authenticated
  using (exists (select 1 from sgc.cartillas c where c.id = cartilla_id and sgc.puede_ver_cartilla(c.proyecto_id, c.ingeniero_id)));

grant select on sgc.acero_diametros, sgc.cartilla_figuras, sgc.cartillas, sgc.cartilla_atados,
  sgc.cartilla_piezas, sgc.cartilla_fotos, sgc.cartilla_eventos to authenticated;

-- 5) notif_tipo — cartilla_nueva ------------------------------------------------
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('cartilla_nueva', 'Cartilla de acero', 'El ingeniero envió una cartilla para revisión de oficina.', false, array['in_app','push'], true, 65)
on conflict (tipo) do nothing;

commit;
