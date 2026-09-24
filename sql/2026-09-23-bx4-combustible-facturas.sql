-- ============================================================================
-- BX4 — Guardar SIEMPRE el PDF que Raykler sube a la conciliación de combustible,
-- AL SUBIR (antes de parsear). Hoy BJ2 solo lo guarda al CONFIRMAR el import; si el
-- parse falla (julio) o el usuario cancela, no queda nada → julio "no está en prod"
-- y Tecnología no puede arreglar el parser sin pedirle el archivo a Raykler.
--
--   · Tabla `combustible_facturas` con estado + diagnóstico + miniatura.
--   · `registros_combustible.factura_id` y `conciliaciones_combustible.factura_id`
--     (AT11: cada echada importada → Ver factura; la conciliación enlaza su factura).
--   · Bucket `sgc-combustible` (privado) ya existe (BJ2); aquí solo se verifica.
--   · Dedupe por nº de factura (FA26/220111) o, si no se pudo leer, por sha256.
--   · RLS: lectura `es_flota_elevado()`/admin; escritura solo por los RPC definer.
--
-- Aditivo/idempotente. ROLES §6.1 (tabla nueva = RLS por rol). Regla 3 (grants).
-- Apply: node scripts/apply-migration.mjs sql/2026-09-23-bx4-combustible-facturas.sql --env dev  →  --env prod
-- Rollback: drop table sgc.combustible_facturas cascade;
--           alter table sgc.registros_combustible drop column if exists factura_id;
--           alter table sgc.conciliaciones_combustible drop column if exists factura_id;
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (1) Tabla de facturas subidas ───────────────────────────────────────────
create table if not exists sgc.combustible_facturas (
  id             uuid primary key default gen_random_uuid(),
  nro_factura    text,                       -- "FA26/220111" (null si no se pudo leer)
  estacion       text default 'Total Energies',
  archivo_path   text not null,              -- sgc-combustible/facturas/<año>/<nro|hash>.pdf
  miniatura_path text,                       -- .../<id>-p1.png (BX4 F4)
  tamano         bigint,                     -- bytes del PDF (ligero: ~144 KB)
  paginas        int,
  fecha_documento date,
  total_factura  numeric,
  sha256         text,                       -- huella del PDF (dedupe cuando no hay nº)
  estado         text not null default 'subida'
                 check (estado in ('subida','parseada','importada','fallida')),
  diagnostico    jsonb,                      -- {diagnostico, rows, cards, cuadre, columnas_faltantes}
  conciliacion_id uuid references sgc.conciliaciones_combustible(id) on delete set null,
  subido_por     uuid references sgc.usuarios(id),
  subido_en      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table sgc.combustible_facturas is
  'BX4 — PDF de factura de combustible guardado AL SUBIR (antes de parsear), con estado y diagnóstico. El documento fiscal se conserva aunque el parse falle.';

-- Dedupe: por nº de factura (cuando se leyó) y por sha256 (cuando no).
create unique index if not exists uq_comb_facturas_nro    on sgc.combustible_facturas (nro_factura) where nro_factura is not null;
create unique index if not exists uq_comb_facturas_sha256 on sgc.combustible_facturas (sha256)      where sha256 is not null;
create index if not exists idx_comb_facturas_subido on sgc.combustible_facturas (subido_en desc);

-- ── (2) Enlaces (AT11 — la data enviada se ve) ──────────────────────────────
alter table sgc.registros_combustible
  add column if not exists factura_id uuid references sgc.combustible_facturas(id) on delete set null;
alter table sgc.conciliaciones_combustible
  add column if not exists factura_id uuid references sgc.combustible_facturas(id) on delete set null;

-- ── (3) RLS (ROLES §6.1): lectura para flota-elevado/admin; escritura vía RPC ─
alter table sgc.combustible_facturas enable row level security;
drop policy if exists comb_facturas_sel on sgc.combustible_facturas;
create policy comb_facturas_sel on sgc.combustible_facturas
  for select to authenticated using (sgc.is_admin() or sgc.es_flota_elevado());
-- Sin políticas INSERT/UPDATE/DELETE: solo los RPC security-definer escriben.
grant select on sgc.combustible_facturas to authenticated;

-- ── (4) RPC: registrar la factura AL SUBIR (dedupe) ─────────────────────────
create or replace function sgc.combustible_factura_registrar(
  p_archivo_path text,
  p_nro_factura  text default null,
  p_estacion     text default null,
  p_tamano       bigint default null,
  p_paginas      int default null,
  p_fecha_documento date default null,
  p_total_factura numeric default null,
  p_sha256       text default null
) returns jsonb
language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
declare
  v_row  sgc.combustible_facturas%rowtype;
  v_nro  text := nullif(btrim(coalesce(p_nro_factura,'')),'');
  v_sha  text := nullif(btrim(coalesce(p_sha256,'')),'');
  v_existente boolean := false;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Solo referentes de flota pueden subir facturas de combustible' using errcode = '42501';
  end if;
  -- Dedupe: misma factura (por nº) o mismo archivo (por sha256) → devuelve la existente.
  if v_nro is not null then
    select * into v_row from sgc.combustible_facturas where nro_factura = v_nro limit 1;
  end if;
  if not found and v_sha is not null then
    select * into v_row from sgc.combustible_facturas where sha256 = v_sha limit 1;
  end if;
  if found then
    v_existente := true;
  else
    insert into sgc.combustible_facturas
      (nro_factura, estacion, archivo_path, tamano, paginas, fecha_documento, total_factura, sha256, estado, subido_por)
    values
      (v_nro, coalesce(nullif(p_estacion,''),'Total Energies'), p_archivo_path, p_tamano, p_paginas,
       p_fecha_documento, p_total_factura, v_sha, 'subida', auth.uid())
    returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'existente', v_existente,
                            'estado', v_row.estado, 'nro_factura', v_row.nro_factura,
                            'archivo_path', v_row.archivo_path,
                            'subido_por', (select nombre from sgc.usuarios where id = v_row.subido_por),
                            'subido_en', v_row.subido_en);
end $fn$;
grant execute on function sgc.combustible_factura_registrar(text,text,text,bigint,int,date,numeric,text) to authenticated, service_role;

-- ── (5) RPC: actualizar estado/diagnóstico/miniatura tras parsear ───────────
create or replace function sgc.combustible_factura_actualizar(
  p_id uuid, p_estado text default null, p_diagnostico jsonb default null,
  p_miniatura_path text default null, p_nro_factura text default null,
  p_fecha_documento date default null, p_total_factura numeric default null,
  p_paginas int default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update sgc.combustible_facturas set
    estado         = coalesce(nullif(p_estado,''), estado),
    diagnostico    = coalesce(p_diagnostico, diagnostico),
    miniatura_path = coalesce(nullif(p_miniatura_path,''), miniatura_path),
    nro_factura    = coalesce(nro_factura, nullif(p_nro_factura,'')),
    fecha_documento= coalesce(fecha_documento, p_fecha_documento),
    total_factura  = coalesce(total_factura, p_total_factura),
    paginas        = coalesce(paginas, p_paginas),
    updated_at     = now()
  where id = p_id;
end $fn$;
grant execute on function sgc.combustible_factura_actualizar(uuid,text,jsonb,text,text,date,numeric,int) to authenticated, service_role;

-- ── (6) RPC: enlazar la factura a la conciliación guardada ──────────────────
create or replace function sgc.combustible_factura_vincular(p_id uuid, p_conciliacion_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp' as $fn$
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update sgc.combustible_facturas
     set conciliacion_id = p_conciliacion_id, estado = 'importada', updated_at = now()
   where id = p_id;
  update sgc.conciliaciones_combustible set factura_id = p_id where id = p_conciliacion_id;
end $fn$;
grant execute on function sgc.combustible_factura_vincular(uuid,uuid) to authenticated, service_role;

-- ── (7) RPC: listar facturas (con quién subió y conciliación) ───────────────
create or replace function sgc.combustible_facturas_listar()
returns table(
  id uuid, nro_factura text, estacion text, archivo_path text, miniatura_path text,
  tamano bigint, paginas int, fecha_documento date, total_factura numeric,
  estado text, diagnostico jsonb, conciliacion_id uuid,
  subido_por_nombre text, subido_en timestamptz
) language sql stable security definer set search_path to 'sgc','pg_temp' as $fn$
  select f.id, f.nro_factura, f.estacion, f.archivo_path, f.miniatura_path,
         f.tamano, f.paginas, f.fecha_documento, f.total_factura,
         f.estado, f.diagnostico, f.conciliacion_id,
         u.nombre, f.subido_en
  from sgc.combustible_facturas f
  left join sgc.usuarios u on u.id = f.subido_por
  where sgc.is_admin() or sgc.es_flota_elevado()
  order by f.subido_en desc;
$fn$;
grant execute on function sgc.combustible_facturas_listar() to authenticated, service_role;

commit;
