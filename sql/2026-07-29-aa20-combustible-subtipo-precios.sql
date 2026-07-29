-- ============================================================================
-- PROMPT-9 · FASE 3 — AA20: subtipo regular/premium + precios oficiales RD (MICM)
-- Fecha: 2026-07-29
-- Aditivo / idempotente / retrocompatible.
--
-- (a) Subtipo de producto en las echadas: `subtipo` (regular | premium). El
--     `producto` sigue siendo gasolina|diesel; combinado da el producto canónico
--     (gasolina_regular, gasolina_premium, diesel_regular, diesel_premium) que
--     cierra el círculo con la conciliación Total Energies (Z23) y con los precios
--     oficiales. Mapeo del reporte TE (verificado):
--       REG. MOGAS  → gasolina_regular   EXC. MOGAS → gasolina_premium
--       DIESEL REG  → diesel_regular     DIESEL EXC → diesel_premium (= GASOIL OPTIMO)
-- (b) Precios oficiales: tabla `fuel_prices` poblada por la edge `fuel-prices`
--     desde el dataset del MICM (CSV en micm.gob.do; ver PROMPT-9 resumen para la
--     cadencia real ~semanal). Se usa como referencia al revisar echadas, alerta
--     suave de desviación y widget "precios vigentes".
-- ============================================================================

-- ── (a) Subtipo en las echadas ───────────────────────────────────────────────
alter table sgc.registros_combustible
  add column if not exists subtipo text;

do $$ begin
  alter table sgc.registros_combustible
    add constraint registros_combustible_subtipo_chk check (subtipo in ('regular', 'premium'));
exception when duplicate_object then null; end $$;

comment on column sgc.registros_combustible.subtipo is
  'AA20 — regular | premium. Con `producto` (gasolina|diesel) forma el producto canónico para precios oficiales y conciliación.';

-- Producto canónico (para cruzar con fuel_prices y el reporte TE).
create or replace function sgc.combustible_producto_canonico(p_producto text, p_subtipo text)
returns text language sql immutable as $$
  select case
    when p_producto is null then null
    when p_subtipo is null then p_producto
    else p_producto || '_' || p_subtipo
  end;
$$;

-- ── (b) Precios oficiales ────────────────────────────────────────────────────
create table if not exists sgc.fuel_prices (
  id             uuid primary key default gen_random_uuid(),
  producto       text not null,   -- gasolina_regular | gasolina_premium | diesel_regular | diesel_premium
  precio         numeric not null,-- RD$ por galón
  vigencia_desde date not null,
  vigencia_hasta date,
  fuente         text not null default 'MICM',
  created_at     timestamptz not null default now(),
  unique (producto, vigencia_desde)
);

do $$ begin
  alter table sgc.fuel_prices
    add constraint fuel_prices_producto_chk
    check (producto in ('gasolina_regular','gasolina_premium','diesel_regular','diesel_premium'));
exception when duplicate_object then null; end $$;

create index if not exists idx_fuel_prices_producto_vig on sgc.fuel_prices (producto, vigencia_desde desc);

alter table sgc.fuel_prices enable row level security;

-- Lectura: cualquier autenticado (precio público). Escritura: solo service_role (edge).
do $$ begin
  create policy "fuel_prices: read" on sgc.fuel_prices for select to authenticated using (true);
exception when duplicate_object then null; end $$;

grant select on sgc.fuel_prices to authenticated;
grant select, insert, update on sgc.fuel_prices to service_role;

-- Precio oficial vigente por producto canónico (el más reciente con vigencia ≤ hoy).
create or replace function sgc.precio_combustible_vigente(p_producto text)
returns numeric language sql stable security definer set search_path = sgc, public as $$
  select precio from sgc.fuel_prices
  where producto = p_producto and vigencia_desde <= current_date
  order by vigencia_desde desc
  limit 1;
$$;
grant execute on function sgc.precio_combustible_vigente(text) to authenticated, service_role;

-- Todos los precios vigentes (para el widget "precios vigentes").
create or replace function sgc.precios_combustible_vigentes()
returns table (producto text, precio numeric, vigencia_desde date, fuente text)
language sql stable security definer set search_path = sgc, public as $$
  select distinct on (producto) producto, precio, vigencia_desde, fuente
  from sgc.fuel_prices
  where vigencia_desde <= current_date
  order by producto, vigencia_desde desc;
$$;
grant execute on function sgc.precios_combustible_vigentes() to authenticated, service_role;

-- Fija el subtipo de una echada (web). Helper SECURITY DEFINER para no tocar la
-- firma del RPC registrar_combustible_app (compartida con la app / PROMPT-10);
-- la app añadirá p_subtipo a ese RPC en su ronda. Gated a flota/admin/conductor.
create or replace function sgc.set_echada_subtipo(p_id uuid, p_subtipo text)
returns void language plpgsql security definer set search_path = sgc, public as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid())) then
    raise exception 'No autorizado';
  end if;
  if p_subtipo is not null and p_subtipo not in ('regular','premium') then
    raise exception 'Subtipo inválido (regular|premium).';
  end if;
  update sgc.registros_combustible set subtipo = p_subtipo where id = p_id;
end $$;
grant execute on function sgc.set_echada_subtipo(uuid, text) to authenticated, service_role;
