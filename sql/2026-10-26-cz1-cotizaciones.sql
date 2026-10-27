-- ============================================================================
-- CZ1/CZ2 (PROMPT-120, ronda CZ, 26/10/2026) — Biblioteca de Cotizaciones de
-- Tecnología.
--
-- Nota 1 de Xaviel: "In the module of Tecnologia we need a Cotizaciones
-- submodule where i can upload and save all the cotizations i did in
-- reference to tech things. These cotizations must be related if the user
-- want with some item of the inventary that was bought based on that
-- cotization and with a Compra tecnologica or solicitud de compra
-- tecnologica."
--
-- Lo que YA existía (CO8/CQ1/QA-070) y esta migración NO duplica:
--   - sgc.solicitud_compra_adjuntos (tipo='cotizacion', bucket privado
--     'compras-cotizaciones', columnas fecha/lectura/lectura_costo_usd).
--   - sgc.compra_tec_adjuntar_cotizacion / compra_tec_elegir_cotizacion.
--   - sgc.tec_equipos.origen_solicitud_compra_id (trazabilidad compra→equipo).
-- Lo que faltaba (DZ-02/03/04/05/06, CONTEXTO-ACTUALIZACION-59 §2): una
-- pantalla/biblioteca propia (hoy una cotización solo se ve DENTRO de una
-- compra), subir una cotización SIN compra, y ligarla directo a equipos.
--
-- "Compra tecnológica" = "solicitud de compra tecnológica" (DZ-04): es la
-- MISMA tabla sgc.solicitudes_compra con categoria='tecnologia' — una sola
-- relación M:N (tec_cotizacion_compras), no dos.
--
-- El archivo REUSA el bucket `compras-cotizaciones` (no se duplica, DZ-02):
-- una cotización de la biblioteca sin compra sube a la MISMA ruta de bucket
-- `<cotizacion_id>/...` en vez de `<solicitud_id>/...`; la política de
-- storage ya existente se amplía abajo.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-10-26-cz1-cotizaciones.sql --env dev
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 0) Permiso granular (AG12) para el Subadministrador (DZ-05) ─────────────
-- Gate real: sgc.puede_ver_submodulo('tecnologia.cotizaciones') /
-- puede_operar_submodulo(...) — ya cubren admin e is_admin()/tiene_modulo
-- ('tecnologia') por el `case` de sgc.nivel_submodulo (AG12), así que las
-- políticas de abajo son la ÚNICA fuente (ni admin ni Tecnología necesitan
-- una política aparte).

-- ── 0.5) FIX DE SEGURIDAD (hallazgo de esta ronda, no introducido por CZ) ──
-- `nivel_submodulo()` devuelve NULL cuando nadie otorga el submódulo (ni
-- admin, ni módulo padre, ni permiso granular) — correcto en una política RLS
-- (`using (...)`: NULL se trata igual que FALSE, deniega), pero
-- `puede_ver_submodulo`/`puede_operar_submodulo` PROPAGABAN ese NULL
-- (`nivel_submodulo(...) in ('ver','operar')` y `= 'operar'` dan NULL, no
-- FALSE, cuando el operando izquierdo es NULL). Eso es una trampa real en
-- cualquier RPC que use el patrón `if not sgc.puede_operar_submodulo(...)
-- then raise ... end if;` (como las de abajo): en PL/pgSQL, `IF NOT NULL
-- THEN` es `IF NULL THEN`, que NUNCA entra al bloque — el `raise` nunca
-- dispara y la función sigue de largo SIN el gate, para cualquiera.
-- Encontrado en este round con el smoke de abajo (negativo que fallaba en
-- silencio). Confirmado con `grep` que 2 migraciones previas (ag16b, bh6)
-- usan el mismo patrón `if not puede_operar_submodulo(...)`/`puede_ver_
-- submodulo(...)` — ahí el bug es inofensivo hoy (sus únicos llamadores
-- reales siempre tienen alguna base que da 'ver'/'operar' en sus pruebas),
-- pero queda reportado en el cierre de esta ronda para que alguien lo
-- revise. El fix es aditivo (misma firma, `coalesce(..., false)`) — no
-- cambia el comportamiento en RLS (NULL y FALSE ya se trataban igual ahí),
-- solo hace seguro el patrón imperativo.
create or replace function sgc.puede_ver_submodulo(p_key text)
returns boolean language sql stable set search_path to 'sgc','pg_temp'
as $function$ select coalesce(sgc.nivel_submodulo(p_key) in ('ver','operar'), false); $function$;

create or replace function sgc.puede_operar_submodulo(p_key text)
returns boolean language sql stable set search_path to 'sgc','pg_temp'
as $function$ select coalesce(sgc.nivel_submodulo(p_key) = 'operar', false); $function$;

-- ── 1) Tabla principal: la cotización en sí ─────────────────────────────────
create table if not exists sgc.tec_cotizaciones (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  proveedor           text,
  fecha               date,
  moneda              text not null default 'DOP' check (moneda in ('DOP', 'USD')),
  subtotal            numeric,
  itbis               numeric,
  total               numeric,
  estado              text not null default 'vigente' check (estado in ('vigente', 'usada', 'descartada')),
  archivo_path        text,
  archivo_nombre      text,
  lectura             jsonb,
  lectura_costo_usd   numeric,
  -- DZ-03 — si nació del backfill de una compra, referencia al adjunto de
  -- origen (única fuente de verdad; evita 2 copias del mismo archivo/lectura).
  adjunto_id          uuid unique references sgc.solicitud_compra_adjuntos(id) on delete set null,
  notas               text,
  creado_por          uuid references sgc.usuarios(id),
  es_prueba           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tec_cotizaciones_estado on sgc.tec_cotizaciones (estado);
create index if not exists idx_tec_cotizaciones_creado_por on sgc.tec_cotizaciones (creado_por);

alter table sgc.tec_cotizaciones enable row level security;
drop policy if exists tec_cotizaciones_sel on sgc.tec_cotizaciones;
create policy tec_cotizaciones_sel on sgc.tec_cotizaciones
  for select to authenticated using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'));
drop policy if exists tec_cotizaciones_mut on sgc.tec_cotizaciones;
create policy tec_cotizaciones_mut on sgc.tec_cotizaciones
  for all to authenticated
  using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'))
  with check (sgc.puede_operar_submodulo('tecnologia.cotizaciones'));
grant select on sgc.tec_cotizaciones to authenticated;

-- ── 2) M:N opcional — cotización ↔ compra/solicitud tecnológica (DZ-04) ─────
create table if not exists sgc.tec_cotizacion_compras (
  cotizacion_id       uuid not null references sgc.tec_cotizaciones(id) on delete cascade,
  solicitud_compra_id uuid not null references sgc.solicitudes_compra(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (cotizacion_id, solicitud_compra_id)
);
create index if not exists idx_tec_cot_compras_solicitud on sgc.tec_cotizacion_compras (solicitud_compra_id);

alter table sgc.tec_cotizacion_compras enable row level security;
drop policy if exists tec_cot_compras_sel on sgc.tec_cotizacion_compras;
create policy tec_cot_compras_sel on sgc.tec_cotizacion_compras
  for select to authenticated using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'));
grant select on sgc.tec_cotizacion_compras to authenticated;
-- Sin INSERT/UPDATE/DELETE directos: el único camino de escritura son los RPC
-- `cotizacion_vincular_compra`/`cotizacion_desvincular_compra` (regla BC7).

-- ── 3) M:N opcional — cotización ↔ equipo de inventario TI (DZ-02/CZ2) ─────
create table if not exists sgc.tec_cotizacion_equipos (
  cotizacion_id uuid not null references sgc.tec_cotizaciones(id) on delete cascade,
  equipo_id     uuid not null references sgc.tec_equipos(id) on delete cascade,
  linea_idx     int,
  created_at    timestamptz not null default now(),
  primary key (cotizacion_id, equipo_id)
);
create index if not exists idx_tec_cot_equipos_equipo on sgc.tec_cotizacion_equipos (equipo_id);

alter table sgc.tec_cotizacion_equipos enable row level security;
drop policy if exists tec_cot_equipos_sel on sgc.tec_cotizacion_equipos;
create policy tec_cot_equipos_sel on sgc.tec_cotizacion_equipos
  for select to authenticated using (sgc.puede_ver_submodulo('tecnologia.cotizaciones'));
grant select on sgc.tec_cotizacion_equipos to authenticated;

-- ── 4) RPCs de escritura (SECURITY DEFINER, regla BC7/5) ────────────────────
create or replace function sgc.cotizacion_crear(
  p_titulo text,
  p_proveedor text default null,
  p_fecha date default null,
  p_moneda text default 'DOP',
  p_subtotal numeric default null,
  p_itbis numeric default null,
  p_total numeric default null,
  p_archivo_path text default null,
  p_archivo_nombre text default null,
  p_lectura jsonb default null,
  p_lectura_costo_usd numeric default null,
  p_notas text default null
) returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_id uuid;
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado para registrar cotizaciones.' using errcode = '42501';
  end if;
  if coalesce(trim(p_titulo), '') = '' then
    raise exception 'El título es obligatorio.' using errcode = '22023';
  end if;

  insert into sgc.tec_cotizaciones
    (titulo, proveedor, fecha, moneda, subtotal, itbis, total, archivo_path, archivo_nombre,
     lectura, lectura_costo_usd, notas, creado_por)
  values
    (trim(p_titulo), nullif(trim(p_proveedor), ''), p_fecha, coalesce(nullif(p_moneda, ''), 'DOP'),
     p_subtotal, p_itbis, p_total, p_archivo_path, p_archivo_nombre,
     p_lectura, p_lectura_costo_usd, nullif(trim(p_notas), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function sgc.cotizacion_crear(text, text, date, text, numeric, numeric, numeric, text, text, jsonb, numeric, text) to authenticated;

create or replace function sgc.cotizacion_actualizar(
  p_id uuid,
  p_titulo text,
  p_proveedor text,
  p_fecha date,
  p_moneda text,
  p_subtotal numeric,
  p_itbis numeric,
  p_total numeric,
  p_notas text
) returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado para editar cotizaciones.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.tec_cotizaciones where id = p_id) then
    raise exception 'Cotización no encontrada.';
  end if;
  if coalesce(trim(p_titulo), '') = '' then
    raise exception 'El título es obligatorio.' using errcode = '22023';
  end if;

  update sgc.tec_cotizaciones set
    titulo = trim(p_titulo),
    proveedor = nullif(trim(p_proveedor), ''),
    fecha = p_fecha,
    moneda = coalesce(nullif(p_moneda, ''), 'DOP'),
    subtotal = p_subtotal,
    itbis = p_itbis,
    total = p_total,
    notas = nullif(trim(p_notas), ''),
    updated_at = now()
  where id = p_id;
end;
$$;
grant execute on function sgc.cotizacion_actualizar(uuid, text, text, date, text, numeric, numeric, numeric, text) to authenticated;

-- Sube el archivo primero (storage), luego fija su ruta — evita una entrada
-- de biblioteca "a medio crear" si la subida fallara antes del RPC.
create or replace function sgc.cotizacion_setear_archivo(p_id uuid, p_archivo_path text, p_archivo_nombre text)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.tec_cotizaciones set archivo_path = p_archivo_path, archivo_nombre = p_archivo_nombre, updated_at = now()
  where id = p_id;
  if not found then raise exception 'Cotización no encontrada.'; end if;
end;
$$;
grant execute on function sgc.cotizacion_setear_archivo(uuid, text, text) to authenticated;

create or replace function sgc.cotizacion_descartar(p_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.tec_cotizaciones set estado = 'descartada', updated_at = now() where id = p_id;
  if not found then raise exception 'Cotización no encontrada.'; end if;
end;
$$;
grant execute on function sgc.cotizacion_descartar(uuid) to authenticated;

create or replace function sgc.cotizacion_restaurar(p_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.tec_cotizaciones set estado = 'vigente', updated_at = now()
  where id = p_id and estado = 'descartada';
  if not found then raise exception 'Cotización no encontrada o no estaba descartada.'; end if;
end;
$$;
grant execute on function sgc.cotizacion_restaurar(uuid) to authenticated;

create or replace function sgc.cotizacion_vincular_compra(p_cotizacion_id uuid, p_solicitud_compra_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.tec_cotizaciones where id = p_cotizacion_id) then
    raise exception 'Cotización no encontrada.';
  end if;
  if not exists (select 1 from sgc.solicitudes_compra where id = p_solicitud_compra_id and categoria = 'tecnologia') then
    raise exception 'Compra tecnológica no encontrada.';
  end if;
  insert into sgc.tec_cotizacion_compras (cotizacion_id, solicitud_compra_id)
  values (p_cotizacion_id, p_solicitud_compra_id)
  on conflict do nothing;
  update sgc.tec_cotizaciones set estado = 'usada', updated_at = now()
  where id = p_cotizacion_id and estado = 'vigente';
end;
$$;
grant execute on function sgc.cotizacion_vincular_compra(uuid, uuid) to authenticated;

create or replace function sgc.cotizacion_desvincular_compra(p_cotizacion_id uuid, p_solicitud_compra_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  delete from sgc.tec_cotizacion_compras
  where cotizacion_id = p_cotizacion_id and solicitud_compra_id = p_solicitud_compra_id;
end;
$$;
grant execute on function sgc.cotizacion_desvincular_compra(uuid, uuid) to authenticated;

create or replace function sgc.cotizacion_vincular_equipo(p_cotizacion_id uuid, p_equipo_id uuid, p_linea_idx int default null)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.tec_cotizaciones where id = p_cotizacion_id) then
    raise exception 'Cotización no encontrada.';
  end if;
  if not exists (select 1 from sgc.tec_equipos where id = p_equipo_id) then
    raise exception 'Equipo no encontrado.';
  end if;
  insert into sgc.tec_cotizacion_equipos (cotizacion_id, equipo_id, linea_idx)
  values (p_cotizacion_id, p_equipo_id, p_linea_idx)
  on conflict (cotizacion_id, equipo_id) do update set linea_idx = excluded.linea_idx;
end;
$$;
grant execute on function sgc.cotizacion_vincular_equipo(uuid, uuid, int) to authenticated;

create or replace function sgc.cotizacion_desvincular_equipo(p_cotizacion_id uuid, p_equipo_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  delete from sgc.tec_cotizacion_equipos
  where cotizacion_id = p_cotizacion_id and equipo_id = p_equipo_id;
end;
$$;
grant execute on function sgc.cotizacion_desvincular_equipo(uuid, uuid) to authenticated;

-- DZ-06 — ficha del equipo: "Cotización de origen" directa, o si no hay, la
-- ELEGIDA de su origen_solicitud_compra_id (sin cambiar el selector actual).
create or replace function sgc.cotizacion_de_equipo(p_equipo_id uuid)
returns table (cotizacion_id uuid, titulo text, directa boolean)
language plpgsql stable security definer set search_path = sgc, public
as $$
declare v_origen uuid;
begin
  if not sgc.puede_ver_submodulo('tecnologia.cotizaciones') then
    return;
  end if;

  return query
    select ce.cotizacion_id, c.titulo, true
    from sgc.tec_cotizacion_equipos ce
    join sgc.tec_cotizaciones c on c.id = ce.cotizacion_id
    where ce.equipo_id = p_equipo_id
    order by ce.created_at desc
    limit 1;
  if found then return; end if;

  select e.origen_solicitud_compra_id into v_origen from sgc.tec_equipos e where e.id = p_equipo_id;
  if v_origen is null then return; end if;

  return query
    select cc.cotizacion_id, c.titulo, false
    from sgc.tec_cotizacion_compras cc
    join sgc.tec_cotizaciones c on c.id = cc.cotizacion_id
    where cc.solicitud_compra_id = v_origen
    order by (c.estado = 'usada') desc, c.created_at desc
    limit 1;
end;
$$;
grant execute on function sgc.cotizacion_de_equipo(uuid) to authenticated;

-- ── 5) compra_tec_adjuntar_cotizacion también registra en la biblioteca
--      (DZ-03 — sin cambiar la firma, la pantalla de Compras sigue igual) ───
create or replace function sgc.compra_tec_adjuntar_cotizacion(
  p_id uuid,
  p_tipo text,
  p_proveedor text,
  p_monto numeric,
  p_path text,
  p_nombre text,
  p_fecha date default null,
  p_lectura jsonb default null,
  p_lectura_costo_usd numeric default null
)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol sgc.solicitudes_compra%rowtype; v_adj_id uuid; v_primera boolean; v_cot_id uuid;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_id and categoria = 'tecnologia';
  if not found then raise exception 'Compra tecnológica no encontrada.'; end if;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  select not exists(select 1 from sgc.solicitud_compra_adjuntos where solicitud_id = p_id) into v_primera;
  insert into sgc.solicitud_compra_adjuntos
    (solicitud_id, tipo, proveedor, monto, path, nombre, subido_por, elegida, fecha, lectura, lectura_costo_usd)
  values
    (p_id, coalesce(nullif(p_tipo, ''), 'cotizacion'), p_proveedor, p_monto, p_path, p_nombre, auth.uid(), v_primera,
     p_fecha, p_lectura, p_lectura_costo_usd)
  returning id into v_adj_id;

  -- DZ-03 — solo los adjuntos tipo 'cotizacion' entran a la biblioteca (una
  -- factura u "otro" documento no es una cotización reusable).
  if coalesce(nullif(p_tipo, ''), 'cotizacion') = 'cotizacion' then
    insert into sgc.tec_cotizaciones
      (titulo, proveedor, fecha, archivo_path, archivo_nombre, lectura, lectura_costo_usd, adjunto_id, creado_por, estado)
    values
      (coalesce(nullif(trim(p_proveedor), ''), nullif(p_nombre, ''), 'Cotización'), nullif(trim(p_proveedor), ''),
       p_fecha, p_path, p_nombre, p_lectura, p_lectura_costo_usd, v_adj_id, auth.uid(), 'vigente')
    on conflict (adjunto_id) do nothing
    returning id into v_cot_id;

    if v_cot_id is not null then
      insert into sgc.tec_cotizacion_compras (cotizacion_id, solicitud_compra_id)
      values (v_cot_id, p_id)
      on conflict do nothing;
    end if;
  end if;

  return v_adj_id;
end;
$$;
grant execute on function sgc.compra_tec_adjuntar_cotizacion(uuid, text, text, numeric, text, text, date, jsonb, numeric) to authenticated;

-- DZ-03 — compra_tec_elegir_cotizacion ahora también marca 'usada' en la
-- biblioteca a la elegida (y vuelve 'vigente' a las demás de esa MISMA compra
-- que no tenían otro vínculo propio) — sin cambiar su firma.
create or replace function sgc.compra_tec_elegir_cotizacion(p_adjunto_id uuid)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare v_sol_id uuid; v_sol sgc.solicitudes_compra%rowtype;
begin
  select solicitud_id into v_sol_id from sgc.solicitud_compra_adjuntos where id = p_adjunto_id;
  if v_sol_id is null then raise exception 'Cotización no encontrada.'; end if;
  select * into v_sol from sgc.solicitudes_compra where id = v_sol_id;
  if v_sol.solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.solicitud_compra_adjuntos set elegida = (id = p_adjunto_id) where solicitud_id = v_sol_id;

  update sgc.tec_cotizaciones c set estado = 'usada', updated_at = now()
  where c.adjunto_id = p_adjunto_id;

  update sgc.tec_cotizaciones c set estado = 'vigente', updated_at = now()
  where c.estado = 'usada'
    and c.adjunto_id in (select a.id from sgc.solicitud_compra_adjuntos a where a.solicitud_id = v_sol_id and a.id <> p_adjunto_id);
end;
$$;
grant execute on function sgc.compra_tec_elegir_cotizacion(uuid) to authenticated;

-- ── 6) Backfill idempotente desde solicitud_compra_adjuntos (DZ-03) ─────────
insert into sgc.tec_cotizaciones
  (titulo, proveedor, fecha, archivo_path, archivo_nombre, lectura, lectura_costo_usd,
   adjunto_id, creado_por, estado, created_at)
select
  coalesce(nullif(trim(a.proveedor), ''), nullif(a.nombre, ''), 'Cotización'),
  nullif(trim(a.proveedor), ''),
  a.fecha,
  a.path,
  a.nombre,
  a.lectura,
  a.lectura_costo_usd,
  a.id,
  a.subido_por,
  case when a.elegida then 'usada' else 'vigente' end,
  a.created_at
from sgc.solicitud_compra_adjuntos a
where a.tipo = 'cotizacion'
on conflict (adjunto_id) do nothing;

insert into sgc.tec_cotizacion_compras (cotizacion_id, solicitud_compra_id, created_at)
select c.id, a.solicitud_id, a.created_at
from sgc.tec_cotizaciones c
join sgc.solicitud_compra_adjuntos a on a.id = c.adjunto_id
on conflict do nothing;

-- ── 7) Bucket `compras-cotizaciones` — amplía a la biblioteca SIN compra ────
-- Camino nuevo: subir con ruta `biblioteca/<cotizacion_id>/<archivo>` (el
-- camino viejo `<solicitud_id>/<archivo>` de una compra sigue igual).
drop policy if exists "compras-cotizaciones: lectura de la propia o aprobador/tecnologia" on storage.objects;
create policy "compras-cotizaciones: lectura de la propia o aprobador/tecnologia" on storage.objects
  for select to authenticated using (
    bucket_id = 'compras-cotizaciones' and (
      sgc.es_tecnologia() or
      sgc.puede_ver_submodulo('tecnologia.cotizaciones') or
      exists (
        select 1 from sgc.solicitud_compra_adjuntos a
        join sgc.solicitudes_compra sc on sc.id = a.solicitud_id
        where a.path = storage.objects.name
          and (sc.solicitante_id = auth.uid() or sc.aprobador_id = auth.uid())
      )
    )
  );
drop policy if exists "compras-cotizaciones: subida de usuarios de tecnologia" on storage.objects;
create policy "compras-cotizaciones: subida de usuarios de tecnologia" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'compras-cotizaciones' and (
      sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.cotizaciones')
    )
  );

commit;
