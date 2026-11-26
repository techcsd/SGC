-- ============================================================================
-- EA1 (ronda EA, 24/11/2026) — Módulo de PROVEEDORES DE TECNOLOGÍA.
--
-- Nota de Xaviel: "Crear o tener en tecnologia el módulo de proveedores de
-- tecnología. Con toda su info, contactos, trabajos realizados, facturas por
-- proveedor y todo. Por ejemplo ahora quiero contactar al de las puertas
-- (cerradura inteligente) y no recuerdo cómo se llamaba ese proveedor."
--
-- Qué crea (todo ADITIVO, idempotente, sin borrar nada):
--   * sgc.tec_proveedores / tec_proveedor_contactos / tec_proveedor_trabajos /
--     tec_proveedor_facturas / tec_proveedor_categorias (catálogo editable).
--   * proveedor_id NULLABLE en sgc.tec_cotizaciones y sgc.solicitudes_compra
--     (la "compra tecnológica" es solicitudes_compra con categoria='tecnologia').
--   * Bucket privado `tec-proveedores` (facturas/adjuntos).
--   * Submódulo `tecnologia.proveedores` (se registra en roles.service.ts, igual
--     que tecnologia.cotizaciones; no hay tabla de submódulos). Permisos:
--       - Tecnología (módulo) y admin: operar (por sgc.nivel_submodulo, AG12).
--       - Compras (módulo): SOLO VER — se les concede permisos
--         {"tecnologia.proveedores":"ver"} en sgc.roles (paso 9).
--   * RPCs definer: buscar_tec_proveedores(q), tec_proveedores_por_revisar(),
--     tec_proveedor_crear_desde_cotizacion(), tec_proveedor_vincular().
--   * Backfill idempotente por nombre normalizado; los dudosos NO se tocan y
--     salen en tec_proveedores_por_revisar().
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-24-ea1-tec-proveedores.sql --env dev   (luego prod)
-- Reversa: sql/_reversa/2026-11-24-ea1-tec-proveedores.reversa.sql
-- Casos RLS por rol: docs/EA1-PROVEEDORES-TEC.md (no hay harness SQL en el repo).
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) Funciones puras de normalización (inmutables) ─────────────────────────
-- Espejo exacto de src/shared/utils/proveedor-normalizacion.util.ts (hay spec).
create or replace function sgc.tec_norm_busqueda(p_txt text)
returns text
language sql immutable parallel safe set search_path = pg_catalog
as $$
  select lower(translate(coalesce(p_txt, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'));
$$;
grant execute on function sgc.tec_norm_busqueda(text) to authenticated, service_role;

-- Sin tildes, MAYÚSCULAS, sin puntuación, sin sufijo societario (SRL/SA/EIRL/…).
create or replace function sgc.tec_normalizar_proveedor(p_txt text)
returns text
language sql immutable parallel safe set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    btrim(regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p_txt, ''),
          'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
        '[^A-Z0-9 ]+', ' ', 'g'),
      '\s+', ' ', 'g')),
    '(\s+(SRL|S R L|EIRL|E I R L|SAS|S A S|SA|S A|LTD|LLC|INC|CORP|CXA|CIA))+$', '', 'g'));
$$;
grant execute on function sgc.tec_normalizar_proveedor(text) to authenticated, service_role;

-- Motivo por el que un texto de proveedor NO se autovincula (null = confiable).
create or replace function sgc.tec_prov_motivo_dudoso(p_raw text)
returns text
language sql immutable parallel safe set search_path = pg_catalog
as $$
  select case
    when sgc.tec_normalizar_proveedor(p_raw) = '' then 'vacio'
    when length(sgc.tec_normalizar_proveedor(p_raw)) < 3 then 'muy_corto'
    when sgc.tec_normalizar_proveedor(p_raw) ~ '^[0-9 ]+$' then 'solo_numeros'
    when p_raw ~ '[/;,+&]' or p_raw ~* '\s(y|e|o)\s' then 'varios_proveedores'
    else null
  end;
$$;
grant execute on function sgc.tec_prov_motivo_dudoso(text) to authenticated, service_role;

-- updated_at
create or replace function sgc.tec_prov_touch()
returns trigger language plpgsql set search_path = sgc, public
as $$ begin new.updated_at := now(); return new; end; $$;

-- ── 2) Catálogo editable de categorías ──────────────────────────────────────
create table if not exists sgc.tec_proveedor_categorias (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  orden      int not null default 0,
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_tec_prov_categorias_nombre
  on sgc.tec_proveedor_categorias (lower(nombre));

insert into sgc.tec_proveedor_categorias (nombre, orden) values
  ('Cerraduras y control de acceso', 10),
  ('Cámaras y seguridad electrónica', 20),
  ('Redes y cableado', 30),
  ('Internet y telefonía', 40),
  ('Hardware y equipos', 50),
  ('Software y licencias', 60),
  ('Impresión y suministros', 70),
  ('Energía y UPS', 80),
  ('Servicios en la nube y APIs', 90),
  ('Mantenimiento y soporte TI', 100),
  ('Otros', 999)
on conflict do nothing;

-- ── 3) Proveedor ────────────────────────────────────────────────────────────
create table if not exists sgc.tec_proveedores (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null check (btrim(nombre) <> ''),
  nombre_comercial    text,
  -- Clave de de-duplicación: sin tildes/mayúsculas/SRL/SA/EIRL.
  nombre_normalizado  text generated always as (sgc.tec_normalizar_proveedor(nombre)) stored,
  rnc                 text,
  categoria_id        uuid references sgc.tec_proveedor_categorias(id) on delete set null,
  servicio            text,
  etiquetas           text[] not null default '{}',
  direccion           text,
  ciudad              text,
  web                 text,
  notas               text,
  estado              text not null default 'activo' check (estado in ('activo', 'inactivo')),
  valoracion          smallint check (valoracion between 1 and 5),
  -- 'manual' | 'backfill' (creado por la migración EA1 desde texto libre)
  origen              text not null default 'manual' check (origen in ('manual', 'backfill')),
  creado_por          uuid references sgc.usuarios(id),
  es_prueba           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists uq_tec_proveedores_normalizado
  on sgc.tec_proveedores (nombre_normalizado) where nombre_normalizado <> '' and not es_prueba;
create index if not exists idx_tec_proveedores_categoria on sgc.tec_proveedores (categoria_id);
create index if not exists idx_tec_proveedores_estado on sgc.tec_proveedores (estado);
create index if not exists idx_tec_proveedores_creado_por on sgc.tec_proveedores (creado_por);

drop trigger if exists trg_tec_proveedores_touch on sgc.tec_proveedores;
create trigger trg_tec_proveedores_touch before update on sgc.tec_proveedores
  for each row execute function sgc.tec_prov_touch();

-- ── 4) Contactos ────────────────────────────────────────────────────────────
create table if not exists sgc.tec_proveedor_contactos (
  id           uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references sgc.tec_proveedores(id) on delete cascade,
  nombre       text not null check (btrim(nombre) <> ''),
  cargo        text,
  telefono     text,
  whatsapp     text,
  correo       text,
  principal    boolean not null default false,
  notas        text,
  es_prueba    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_tec_prov_contactos_prov on sgc.tec_proveedor_contactos (proveedor_id);
-- un solo contacto principal por proveedor
create unique index if not exists uq_tec_prov_contacto_principal
  on sgc.tec_proveedor_contactos (proveedor_id) where principal;
drop trigger if exists trg_tec_prov_contactos_touch on sgc.tec_proveedor_contactos;
create trigger trg_tec_prov_contactos_touch before update on sgc.tec_proveedor_contactos
  for each row execute function sgc.tec_prov_touch();

-- ── 5) Trabajos realizados ──────────────────────────────────────────────────
create table if not exists sgc.tec_proveedor_trabajos (
  id                  uuid primary key default gen_random_uuid(),
  proveedor_id        uuid not null references sgc.tec_proveedores(id) on delete cascade,
  fecha               date,
  titulo              text not null check (btrim(titulo) <> ''),
  descripcion         text,
  costo               numeric check (costo is null or costo >= 0),
  moneda              text not null default 'DOP' check (moneda in ('DOP', 'USD')),
  estado              text not null default 'completado'
                        check (estado in ('cotizado', 'en_curso', 'completado', 'cancelado')),
  cotizacion_id       uuid references sgc.tec_cotizaciones(id) on delete set null,
  solicitud_compra_id uuid references sgc.solicitudes_compra(id) on delete set null,
  equipo_id           uuid references sgc.tec_equipos(id) on delete set null,
  creado_por          uuid references sgc.usuarios(id),
  es_prueba           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tec_prov_trabajos_prov on sgc.tec_proveedor_trabajos (proveedor_id, fecha desc);
create index if not exists idx_tec_prov_trabajos_cot on sgc.tec_proveedor_trabajos (cotizacion_id);
create index if not exists idx_tec_prov_trabajos_sol on sgc.tec_proveedor_trabajos (solicitud_compra_id);
create index if not exists idx_tec_prov_trabajos_equipo on sgc.tec_proveedor_trabajos (equipo_id);
drop trigger if exists trg_tec_prov_trabajos_touch on sgc.tec_proveedor_trabajos;
create trigger trg_tec_prov_trabajos_touch before update on sgc.tec_proveedor_trabajos
  for each row execute function sgc.tec_prov_touch();

-- ── 6) Facturas ─────────────────────────────────────────────────────────────
create table if not exists sgc.tec_proveedor_facturas (
  id                  uuid primary key default gen_random_uuid(),
  proveedor_id        uuid not null references sgc.tec_proveedores(id) on delete cascade,
  numero              text not null check (btrim(numero) <> ''),
  fecha               date,
  monto               numeric check (monto is null or monto >= 0),
  itbis               numeric check (itbis is null or itbis >= 0),
  moneda              text not null default 'DOP' check (moneda in ('DOP', 'USD')),
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  fecha_pago          date,
  archivo_path        text,
  archivo_nombre      text,
  trabajo_id          uuid references sgc.tec_proveedor_trabajos(id) on delete set null,
  cotizacion_id       uuid references sgc.tec_cotizaciones(id) on delete set null,
  solicitud_compra_id uuid references sgc.solicitudes_compra(id) on delete set null,
  notas               text,
  creado_por          uuid references sgc.usuarios(id),
  es_prueba           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tec_prov_facturas_prov on sgc.tec_proveedor_facturas (proveedor_id, fecha desc);
create index if not exists idx_tec_prov_facturas_trabajo on sgc.tec_proveedor_facturas (trabajo_id);
create index if not exists idx_tec_prov_facturas_cot on sgc.tec_proveedor_facturas (cotizacion_id);
create index if not exists idx_tec_prov_facturas_sol on sgc.tec_proveedor_facturas (solicitud_compra_id);
drop trigger if exists trg_tec_prov_facturas_touch on sgc.tec_proveedor_facturas;
create trigger trg_tec_prov_facturas_touch before update on sgc.tec_proveedor_facturas
  for each row execute function sgc.tec_prov_touch();

-- ── 7) proveedor_id NULLABLE en cotizaciones y compras tecnológicas ─────────
alter table sgc.tec_cotizaciones
  add column if not exists proveedor_id uuid references sgc.tec_proveedores(id) on delete set null;
alter table sgc.solicitudes_compra
  add column if not exists proveedor_tec_id uuid references sgc.tec_proveedores(id) on delete set null;
-- (solicitudes_compra ya tiene `proveedor_id`-style columnas en otros flujos; por eso el
--  nombre explícito `proveedor_tec_id`, que además nunca se confunde con sgc.proveedores.)
create index if not exists idx_tec_cotizaciones_proveedor on sgc.tec_cotizaciones (proveedor_id);
create index if not exists idx_solicitudes_compra_proveedor_tec on sgc.solicitudes_compra (proveedor_tec_id)
  where proveedor_tec_id is not null;

-- ── 8) RLS + grants (submódulo tecnologia.proveedores) ──────────────────────
-- SELECT: puede_ver_submodulo; INSERT/UPDATE/DELETE: puede_operar_submodulo.
-- Grants explícitos (error recurrente "permission denied for schema/table sgc").
grant usage on schema sgc to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'tec_proveedor_categorias', 'tec_proveedores', 'tec_proveedor_contactos',
    'tec_proveedor_trabajos', 'tec_proveedor_facturas'
  ] loop
    execute format('alter table sgc.%I enable row level security', t);
    execute format('drop policy if exists %I on sgc.%I', t || '_sel', t);
    execute format(
      'create policy %I on sgc.%I for select to authenticated using ((select sgc.puede_ver_submodulo(%L)))',
      t || '_sel', t, 'tecnologia.proveedores');
    execute format('drop policy if exists %I on sgc.%I', t || '_ins', t);
    execute format(
      'create policy %I on sgc.%I for insert to authenticated with check ((select sgc.puede_operar_submodulo(%L)))',
      t || '_ins', t, 'tecnologia.proveedores');
    execute format('drop policy if exists %I on sgc.%I', t || '_upd', t);
    execute format(
      'create policy %I on sgc.%I for update to authenticated using ((select sgc.puede_operar_submodulo(%L))) with check ((select sgc.puede_operar_submodulo(%L)))',
      t || '_upd', t, 'tecnologia.proveedores', 'tecnologia.proveedores');
  end loop;
end $$;

-- DELETE solo en hijos (contactos/trabajos/facturas/categorías); el proveedor se
-- DESACTIVA (estado='inactivo'), nunca se borra desde la UI.
do $$
declare t text;
begin
  foreach t in array array[
    'tec_proveedor_categorias', 'tec_proveedor_contactos', 'tec_proveedor_trabajos', 'tec_proveedor_facturas'
  ] loop
    execute format('drop policy if exists %I on sgc.%I', t || '_del', t);
    execute format(
      'create policy %I on sgc.%I for delete to authenticated using ((select sgc.puede_operar_submodulo(%L)))',
      t || '_del', t, 'tecnologia.proveedores');
  end loop;
end $$;

grant select, insert, update on sgc.tec_proveedores to authenticated;
grant select, insert, update, delete on sgc.tec_proveedor_categorias to authenticated;
grant select, insert, update, delete on sgc.tec_proveedor_contactos to authenticated;
grant select, insert, update, delete on sgc.tec_proveedor_trabajos to authenticated;
grant select, insert, update, delete on sgc.tec_proveedor_facturas to authenticated;
-- service_role (edge MCP / jobs): lectura explícita.
grant select on sgc.tec_proveedores, sgc.tec_proveedor_categorias, sgc.tec_proveedor_contactos,
  sgc.tec_proveedor_trabajos, sgc.tec_proveedor_facturas to service_role;
-- Las PK son uuid (gen_random_uuid): no hay secuencias que conceder.

-- ── 9) Compras = SOLO VER (Tecnología/admin operan por el helper AG12) ──────
-- Se FUSIONA con || en roles que tengan el módulo `compras` y NO tengan el módulo
-- `tecnologia` (este ya opera). No pisa un ajuste manual existente.
update sgc.roles
set permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object('tecnologia.proveedores', 'ver')
where 'compras' = any(modulos)
  and not ('tecnologia' = any(modulos))
  and not (coalesce(permisos, '{}'::jsonb) ? 'tecnologia.proveedores');

-- ── 10) RPCs ────────────────────────────────────────────────────────────────
-- Búsqueda única: nombre, comercial, servicio, categoría, etiquetas, RNC, notas,
-- contactos, trabajos, facturas y cotizaciones. Todas las palabras deben aparecer
-- (AND); plurales simples («puertas» ≈ «puerta»); sin tildes ni mayúsculas.
create or replace function sgc.buscar_tec_proveedores(p_q text default null, p_incluir_inactivos boolean default false)
returns table (
  id uuid,
  nombre text,
  nombre_comercial text,
  categoria text,
  servicio text,
  estado text,
  valoracion smallint,
  etiquetas text[],
  contacto_nombre text,
  contacto_telefono text,
  contacto_whatsapp text,
  contacto_correo text,
  coincidencia text,
  puntaje int
)
language plpgsql stable security definer set search_path = sgc, public
as $$
declare
  v_tokens text[];
  v_q text := sgc.tec_norm_busqueda(btrim(coalesce(p_q, '')));
begin
  if not sgc.puede_ver_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado para ver proveedores de tecnología.' using errcode = '42501';
  end if;

  -- tokens ≥2 letras; plural simple: quita la 's' final en palabras largas
  select coalesce(array_agg(case when length(x) > 3 and x like '%s' then left(x, length(x) - 1) else x end), '{}')
    into v_tokens
  from unnest(regexp_split_to_array(v_q, '\s+')) as x
  where length(x) >= 2;

  return query
  with base as (
    select
      p.*,
      c.nombre as cat_nombre,
      sgc.tec_norm_busqueda(concat_ws(' ', p.nombre, p.nombre_comercial)) as h_nombre,
      sgc.tec_norm_busqueda(concat_ws(' ', c.nombre, p.servicio, array_to_string(p.etiquetas, ' '))) as h_servicio,
      sgc.tec_norm_busqueda(concat_ws(' ', p.rnc, p.notas, p.ciudad, p.direccion, p.web)) as h_datos,
      sgc.tec_norm_busqueda(coalesce((
        select string_agg(concat_ws(' ', k.nombre, k.cargo, k.correo, k.telefono, k.whatsapp), ' ')
        from sgc.tec_proveedor_contactos k where k.proveedor_id = p.id), '')) as h_contactos,
      sgc.tec_norm_busqueda(coalesce((
        select string_agg(concat_ws(' ', t.titulo, t.descripcion), ' ')
        from sgc.tec_proveedor_trabajos t where t.proveedor_id = p.id), '')) as h_trabajos,
      sgc.tec_norm_busqueda(coalesce((
        select string_agg(concat_ws(' ', f.numero, f.notas), ' ')
        from sgc.tec_proveedor_facturas f where f.proveedor_id = p.id), '')) as h_facturas,
      sgc.tec_norm_busqueda(coalesce((
        select string_agg(concat_ws(' ', q.titulo, q.notas), ' ')
        from sgc.tec_cotizaciones q where q.proveedor_id = p.id), '')) as h_cotizaciones
    from sgc.tec_proveedores p
    left join sgc.tec_proveedor_categorias c on c.id = p.categoria_id
    where (p_incluir_inactivos or p.estado = 'activo')
  ),
  scored as (
    select
      b.*,
      -- cada token debe aparecer en ALGÚN campo; el puntaje premia nombre/servicio
      (select bool_and(
          strpos(b.h_nombre || ' ' || b.h_servicio || ' ' || b.h_datos || ' ' || b.h_contactos || ' ' ||
                 b.h_trabajos || ' ' || b.h_facturas || ' ' || b.h_cotizaciones, tk) > 0)
         from unnest(v_tokens) tk) as ok,
      (select coalesce(sum(
          (case when strpos(b.h_nombre, tk) > 0 then 10 else 0 end) +
          (case when strpos(b.h_servicio, tk) > 0 then 6 else 0 end) +
          (case when strpos(b.h_contactos, tk) > 0 then 4 else 0 end) +
          (case when strpos(b.h_trabajos, tk) > 0 then 3 else 0 end) +
          (case when strpos(b.h_cotizaciones, tk) > 0 then 2 else 0 end) +
          (case when strpos(b.h_datos || ' ' || b.h_facturas, tk) > 0 then 1 else 0 end)), 0)
         from unnest(v_tokens) tk) as pts
    from base b
  )
  select
    s.id::uuid,
    s.nombre::text,
    s.nombre_comercial::text,
    s.cat_nombre::text,
    s.servicio::text,
    s.estado::text,
    s.valoracion::smallint,
    s.etiquetas::text[],
    pc.nombre::text, pc.telefono::text, pc.whatsapp::text, pc.correo::text,
    (case
      when cardinality(v_tokens) = 0 then null
      when (select bool_and(strpos(s.h_nombre, tk) > 0) from unnest(v_tokens) tk) then 'nombre'
      when (select bool_and(strpos(s.h_servicio, tk) > 0) from unnest(v_tokens) tk) then 'servicio'
      when (select bool_and(strpos(s.h_contactos, tk) > 0) from unnest(v_tokens) tk) then 'contacto'
      when (select bool_and(strpos(s.h_trabajos, tk) > 0) from unnest(v_tokens) tk) then 'trabajo'
      when (select bool_and(strpos(s.h_cotizaciones, tk) > 0) from unnest(v_tokens) tk) then 'cotizacion'
      else 'varios'
    end)::text,
    s.pts::int
  from scored s
  left join lateral (
    select k.nombre, k.telefono, k.whatsapp, k.correo
    from sgc.tec_proveedor_contactos k
    where k.proveedor_id = s.id
    order by k.principal desc, k.created_at
    limit 1
  ) pc on true
  where (cardinality(v_tokens) = 0 or coalesce(s.ok, false))
  order by s.pts desc, s.nombre_normalizado
  limit 200;
end;
$$;
grant execute on function sgc.buscar_tec_proveedores(text, boolean) to authenticated, service_role;

-- Textos de proveedor aún SIN vincular («por revisar»). Nada se borra: es una lista de
-- trabajo para que Tecnología cree/une proveedores a mano.
create or replace function sgc.tec_proveedores_por_revisar()
returns table (
  texto text,
  fuente text,
  usos bigint,
  motivo text,
  sugerencia_id uuid,
  sugerencia_nombre text
)
language plpgsql stable security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_ver_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado para ver proveedores de tecnología.' using errcode = '42501';
  end if;

  return query
  with f as (
    select 'cotizacion'::text as fuente, btrim(c.proveedor) as raw
    from sgc.tec_cotizaciones c
    where c.proveedor_id is null and nullif(btrim(c.proveedor), '') is not null
    union all
    select 'compra', btrim(a.proveedor)
    from sgc.solicitud_compra_adjuntos a
    join sgc.solicitudes_compra s on s.id = a.solicitud_id
    where s.categoria = 'tecnologia' and s.proveedor_tec_id is null
      and a.tipo = 'cotizacion' and nullif(btrim(a.proveedor), '') is not null
    union all
    select 'compra', btrim(i.proveedor_sugerido)
    from sgc.solicitud_compra_items i
    join sgc.solicitudes_compra s on s.id = i.solicitud_id
    where s.categoria = 'tecnologia' and s.proveedor_tec_id is null
      and nullif(btrim(i.proveedor_sugerido), '') is not null
    union all
    select 'api', btrim(a.proveedor)
    from sgc.api_servicios a
    where nullif(btrim(a.proveedor), '') is not null
      -- api_servicios no tiene proveedor_id: si ya existe el proveedor, no hay nada que revisar
      and not exists (select 1 from sgc.tec_proveedores px
                      where px.nombre_normalizado = sgc.tec_normalizar_proveedor(a.proveedor) and not px.es_prueba)
  ),
  g as (
    select
      (array_agg(f.raw order by f.raw))[1] as raw,
      sgc.tec_normalizar_proveedor(f.raw) as norm,
      string_agg(distinct f.fuente, ', ' order by f.fuente) as fuentes,
      count(*) as n
    from f group by sgc.tec_normalizar_proveedor(f.raw)
  )
  select
    g.raw::text,
    g.fuentes::text,
    g.n::bigint,
    coalesce(
      sgc.tec_prov_motivo_dudoso(g.raw),
      case when ex.id is not null then 'sin_vincular' end,
      case when sim.id is not null then 'similar_a_otro' end,
      case when exists (select 1 from g g2 where g2.norm <> g.norm
                          and (g2.norm like g.norm || ' %' or g.norm like g2.norm || ' %')) then 'similar_a_otro' end,
      'sin_coincidencia'
    )::text,
    coalesce(ex.id, sim.id)::uuid,
    coalesce(ex.nombre, sim.nombre)::text
  from g
  left join sgc.tec_proveedores ex on ex.nombre_normalizado = g.norm and g.norm <> ''
  left join lateral (
    select p.id, p.nombre from sgc.tec_proveedores p
    where g.norm <> '' and length(g.norm) >= 4 and p.nombre_normalizado <> g.norm
      and (p.nombre_normalizado like g.norm || ' %' or g.norm like p.nombre_normalizado || ' %')
    order by length(p.nombre_normalizado) limit 1
  ) sim on true
  order by g.n desc, g.raw;
end;
$$;
grant execute on function sgc.tec_proveedores_por_revisar() to authenticated, service_role;

-- Crea (o reutiliza por nombre normalizado) el proveedor de una cotización y la vincula.
create or replace function sgc.tec_proveedor_crear_desde_cotizacion(p_cotizacion_id uuid, p_nombre text default null)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_cot sgc.tec_cotizaciones%rowtype;
  v_nombre text;
  v_id uuid;
begin
  if not sgc.puede_operar_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado para crear proveedores de tecnología.' using errcode = '42501';
  end if;
  select * into v_cot from sgc.tec_cotizaciones where id = p_cotizacion_id;
  if not found then raise exception 'Cotización no encontrada.' using errcode = '22023'; end if;

  v_nombre := nullif(btrim(coalesce(p_nombre, v_cot.proveedor)), '');
  if v_nombre is null then
    raise exception 'La cotización no tiene un nombre de proveedor.' using errcode = '22023';
  end if;

  select id into v_id from sgc.tec_proveedores
  where nombre_normalizado = sgc.tec_normalizar_proveedor(v_nombre) and nombre_normalizado <> '' and not es_prueba
  limit 1;

  if v_id is null then
    insert into sgc.tec_proveedores (nombre, creado_por, es_prueba)
    values (v_nombre, auth.uid(), coalesce(v_cot.es_prueba, false))
    returning id into v_id;
  end if;

  update sgc.tec_cotizaciones set proveedor_id = v_id, updated_at = now() where id = p_cotizacion_id;
  return v_id;
end;
$$;
grant execute on function sgc.tec_proveedor_crear_desde_cotizacion(uuid, text) to authenticated;

-- Vincula un proveedor existente a una cotización y/o a una compra tecnológica.
create or replace function sgc.tec_proveedor_vincular(
  p_proveedor_id uuid,
  p_cotizacion_id uuid default null,
  p_solicitud_compra_id uuid default null
) returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.tec_proveedores where id = p_proveedor_id) then
    raise exception 'Proveedor no encontrado.' using errcode = '22023';
  end if;
  if p_cotizacion_id is not null then
    update sgc.tec_cotizaciones set proveedor_id = p_proveedor_id, updated_at = now() where id = p_cotizacion_id;
    if not found then raise exception 'Cotización no encontrada.' using errcode = '22023'; end if;
  end if;
  if p_solicitud_compra_id is not null then
    update sgc.solicitudes_compra set proveedor_tec_id = p_proveedor_id
    where id = p_solicitud_compra_id and categoria = 'tecnologia';
    if not found then raise exception 'Compra tecnológica no encontrada.' using errcode = '22023'; end if;
  end if;
end;
$$;
grant execute on function sgc.tec_proveedor_vincular(uuid, uuid, uuid) to authenticated;

-- Desvincular (proveedor_id = null), p. ej. cuando se vinculó por error.
create or replace function sgc.tec_proveedor_desvincular(
  p_cotizacion_id uuid default null,
  p_solicitud_compra_id uuid default null
) returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_cotizacion_id is not null then
    update sgc.tec_cotizaciones set proveedor_id = null, updated_at = now() where id = p_cotizacion_id;
  end if;
  if p_solicitud_compra_id is not null then
    update sgc.solicitudes_compra set proveedor_tec_id = null
    where id = p_solicitud_compra_id and categoria = 'tecnologia';
  end if;
end;
$$;
grant execute on function sgc.tec_proveedor_desvincular(uuid, uuid) to authenticated;

-- Detalle de un proveedor para el conector MCP / Compa (solo lectura, jsonb acotado).
-- No incluye rutas de archivos de facturas (nunca se entrega storage a la IA).
create or replace function sgc.tec_proveedor_detalle_asistente(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = sgc, public
as $$
declare v jsonb;
begin
  if not sgc.puede_ver_submodulo('tecnologia.proveedores') then
    raise exception 'No autorizado para ver proveedores de tecnología.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'nombre_comercial', p.nombre_comercial, 'rnc', p.rnc,
    'categoria', c.nombre, 'servicio', p.servicio, 'etiquetas', p.etiquetas,
    'direccion', p.direccion, 'ciudad', p.ciudad, 'web', p.web, 'notas', p.notas,
    'estado', p.estado, 'valoracion', p.valoracion,
    'contactos', coalesce((select jsonb_agg(jsonb_build_object(
        'nombre', k.nombre, 'cargo', k.cargo, 'telefono', k.telefono, 'whatsapp', k.whatsapp,
        'correo', k.correo, 'principal', k.principal) order by k.principal desc, k.created_at)
      from sgc.tec_proveedor_contactos k where k.proveedor_id = p.id), '[]'::jsonb),
    'trabajos', coalesce((select jsonb_agg(jsonb_build_object(
        'fecha', t.fecha, 'titulo', t.titulo, 'descripcion', t.descripcion, 'costo', t.costo,
        'moneda', t.moneda, 'estado', t.estado) order by t.fecha desc nulls last)
      from (select * from sgc.tec_proveedor_trabajos x where x.proveedor_id = p.id
            order by x.fecha desc nulls last limit 20) t), '[]'::jsonb),
    'facturas', coalesce((select jsonb_agg(jsonb_build_object(
        'numero', f.numero, 'fecha', f.fecha, 'monto', f.monto, 'itbis', f.itbis,
        'moneda', f.moneda, 'estado', f.estado) order by f.fecha desc nulls last)
      from (select * from sgc.tec_proveedor_facturas y where y.proveedor_id = p.id
            order by y.fecha desc nulls last limit 20) f), '[]'::jsonb),
    'cotizaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'titulo', q.titulo, 'fecha', q.fecha, 'total', q.total, 'moneda', q.moneda, 'estado', q.estado)
        order by q.created_at desc)
      from (select * from sgc.tec_cotizaciones z where z.proveedor_id = p.id
            order by z.created_at desc limit 20) q), '[]'::jsonb)
  ) into v
  from sgc.tec_proveedores p
  left join sgc.tec_proveedor_categorias c on c.id = p.categoria_id
  where p.id = p_id;
  return v;  -- null si no existe
end;
$$;
grant execute on function sgc.tec_proveedor_detalle_asistente(uuid) to authenticated, service_role;

-- ── 11) Bucket privado `tec-proveedores` ────────────────────────────────────
-- Ruta: <proveedor_id>/<archivo>. Lee quien VE el submódulo; escribe quien lo OPERA.
-- Upsert permitido: por eso hay política INSERT *y* UPDATE (regla BI1).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tec-proveedores', 'tec-proveedores', false, 15728640,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "tec-proveedores: lectura" on storage.objects;
create policy "tec-proveedores: lectura" on storage.objects
  for select to authenticated using (
    bucket_id = 'tec-proveedores' and (select sgc.puede_ver_submodulo('tecnologia.proveedores'))
  );
drop policy if exists "tec-proveedores: subida" on storage.objects;
create policy "tec-proveedores: subida" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'tec-proveedores' and (select sgc.puede_operar_submodulo('tecnologia.proveedores'))
  );
drop policy if exists "tec-proveedores: actualizar" on storage.objects;
create policy "tec-proveedores: actualizar" on storage.objects
  for update to authenticated
  using (bucket_id = 'tec-proveedores' and (select sgc.puede_operar_submodulo('tecnologia.proveedores')))
  with check (bucket_id = 'tec-proveedores' and (select sgc.puede_operar_submodulo('tecnologia.proveedores')));
drop policy if exists "tec-proveedores: borrar" on storage.objects;
create policy "tec-proveedores: borrar" on storage.objects
  for delete to authenticated using (
    bucket_id = 'tec-proveedores' and (select sgc.puede_operar_submodulo('tecnologia.proveedores'))
  );

-- ── 12) BACKFILL idempotente por nombre normalizado ─────────────────────────
-- Fuentes de texto libre: tec_cotizaciones.proveedor, adjuntos/ítems de compras
-- tecnológicas y api_servicios.proveedor (el «apis_consumo» del brief). Los textos
-- DUDOSOS (varios proveedores en uno, muy cortos, similares entre sí) NO se tocan:
-- quedan como texto y salen en sgc.tec_proveedores_por_revisar(). Nada se borra.
create temp table _ea1_fuentes on commit drop as
select 'cotizacion'::text as fuente, btrim(c.proveedor) as raw
from sgc.tec_cotizaciones c where nullif(btrim(c.proveedor), '') is not null
union all
select 'compra', btrim(a.proveedor)
from sgc.solicitud_compra_adjuntos a
join sgc.solicitudes_compra s on s.id = a.solicitud_id
where s.categoria = 'tecnologia' and a.tipo = 'cotizacion' and nullif(btrim(a.proveedor), '') is not null
union all
select 'compra', btrim(i.proveedor_sugerido)
from sgc.solicitud_compra_items i
join sgc.solicitudes_compra s on s.id = i.solicitud_id
where s.categoria = 'tecnologia' and nullif(btrim(i.proveedor_sugerido), '') is not null
union all
select 'api', btrim(a.proveedor)
from sgc.api_servicios a where nullif(btrim(a.proveedor), '') is not null;

create temp table _ea1_grupos on commit drop as
select
  sgc.tec_normalizar_proveedor(raw) as norm,
  mode() within group (order by raw) as nombre,
  bool_and(fuente = 'api') as solo_api,
  bool_or(sgc.tec_prov_motivo_dudoso(raw) is not null) as dudoso
from _ea1_fuentes
group by sgc.tec_normalizar_proveedor(raw);

-- Similitud por prefijo de palabras entre grupos distintos ⇒ ambiguo (a revisar).
update _ea1_grupos g set dudoso = true
where not g.dudoso and exists (
  select 1 from _ea1_grupos g2
  where g2.norm <> g.norm and (g2.norm like g.norm || ' %' or g.norm like g2.norm || ' %')
);

insert into sgc.tec_proveedores (nombre, categoria_id, etiquetas, origen)
select
  g.nombre,
  case when g.solo_api then (select id from sgc.tec_proveedor_categorias where lower(nombre) = lower('Servicios en la nube y APIs')) end,
  case when g.solo_api then array['api'] else '{}'::text[] end,
  'backfill'
from _ea1_grupos g
where not g.dudoso and g.norm <> ''
on conflict (nombre_normalizado) where nombre_normalizado <> '' and not es_prueba do nothing;

-- Vincula cotizaciones (solo grupos confiables).
update sgc.tec_cotizaciones c
set proveedor_id = p.id
from sgc.tec_proveedores p
where c.proveedor_id is null
  and nullif(btrim(c.proveedor), '') is not null
  and p.nombre_normalizado = sgc.tec_normalizar_proveedor(c.proveedor)
  and not p.es_prueba
  and exists (select 1 from _ea1_grupos g where g.norm = p.nombre_normalizado and not g.dudoso);

-- Vincula compras tecnológicas: por el adjunto ELEGIDO; si no hay, por el único
-- proveedor distinto entre sus cotizaciones.
with cand as (
  select a.solicitud_id, p.id as pid, bool_or(a.elegida) as elegida
  from sgc.solicitud_compra_adjuntos a
  join sgc.tec_proveedores p on p.nombre_normalizado = sgc.tec_normalizar_proveedor(a.proveedor) and not p.es_prueba
  join _ea1_grupos g on g.norm = p.nombre_normalizado and not g.dudoso
  where a.tipo = 'cotizacion' and nullif(btrim(a.proveedor), '') is not null
  group by a.solicitud_id, p.id
),
pick as (
  select distinct on (solicitud_id) solicitud_id, pid
  from cand
  where elegida
     or solicitud_id in (select solicitud_id from cand group by solicitud_id having count(*) = 1)
  order by solicitud_id, elegida desc
)
update sgc.solicitudes_compra s
set proveedor_tec_id = pick.pid
from pick
where s.id = pick.solicitud_id and s.categoria = 'tecnologia' and s.proveedor_tec_id is null;

commit;
