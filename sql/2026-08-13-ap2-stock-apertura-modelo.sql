-- =============================================================================
-- PROMPT-11 FASE 4 (AP5) — Modelo de saldo de APERTURA. SGC padre.
--
-- Necesidad: fijar un conteo inicial (1,000) por artículo×almacén para trabajar
-- mientras se hace el levantamiento real, SIN que ese dato ensucie el historial
-- ni el timeline (que NO se vea un "bajón" de los 1,000 ficticios al corregirlo).
--
-- HALLAZGO CLAVE (reconciliación):
--   El stock real (`stock_por_bodega.cantidad`) NO se reconstruye sólo con los
--   movimientos registrados (entradas/salidas/conteos): existe una BASE inicial
--   no rastreada (poblada por seeds/imports directos a stock_por_bodega). Ej:
--   PINO en Bodega Central = 92 real, pero Σ movimientos = −12 → base oculta = 104.
--
-- MODELO:
--   `stock_apertura(articulo, bodega, cantidad)` = la BASE (y-intercepto) de la
--   curva de existencias. Es EDITABLE (solo admin). Cuando NO hay valor explícito,
--   la apertura efectiva = stock_actual − Σ movimientos (la base no rastreada), de
--   modo que el timeline SIEMPRE cierra en el stock real, con o sin seed.
--   Invariante garantizado: stock_por_bodega.cantidad = apertura + Σ movimientos.
--
--   Editar la apertura a X: re-basa el stock a X + Σ movimientos (sin crear
--   movimiento/notificación/kardex). El timeline se re-basa completo → sin escalón.
--   Sólo admin. Traza mínima en `sgc.auditoria` (invisible al kardex).
--
--   Σ movimientos = Σ entradas − Σ salidas + Σ(conteo.contada − conteo.antes),
--   sólo NO-prueba (igual que stock_por_bodega, que ignora es_prueba).
--
-- El SEED masivo (apertura=1,000) va en un archivo aparte y está EN PAUSA
-- (2026-08-13-ap5-seed-apertura-1000-PAUSA.sql) — requiere OK de Xaviel.
-- =============================================================================

begin;

create table if not exists sgc.stock_apertura (
  articulo_id uuid not null references sgc.articulos(id) on delete cascade,
  bodega_id   uuid not null references sgc.bodegas(id)   on delete cascade,
  cantidad    numeric not null default 0 check (cantidad >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (articulo_id, bodega_id)
);
comment on table sgc.stock_apertura is
  'AP5 — saldo de apertura explícito por artículo×almacén (base de la curva). Si no hay fila, la apertura efectiva = stock_actual − Σ movimientos. Editable SOLO por admin vía set_apertura; NO es un movimiento y no aparece en el kardex.';

alter table sgc.stock_apertura enable row level security;

drop policy if exists "stock_apertura: referencia autenticados" on sgc.stock_apertura;
create policy "stock_apertura: referencia autenticados" on sgc.stock_apertura
  for select to authenticated using (auth.uid() is not null);
-- Sin policies de escritura → sólo la RPC SECURITY DEFINER set_apertura (admin).

grant select on sgc.stock_apertura to authenticated;

-- ── Σ movimientos registrados (no-prueba) por artículo×almacén ───────────────
create or replace function sgc.stock_movimientos_sigma(p_articulo_id uuid, p_bodega_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
      coalesce((select sum(de.cantidad)
                from sgc.detalle_entradas de
                join sgc.entradas_inventario e on e.id = de.entrada_id
                where de.articulo_id = p_articulo_id and e.bodega_id = p_bodega_id
                  and not coalesce(e.es_prueba, false)), 0)
    - coalesce((select sum(d.cantidad)
                from sgc.detalle_salidas d
                join sgc.salidas_inventario s on s.id = d.salida_id
                where d.articulo_id = p_articulo_id and s.bodega_id = p_bodega_id
                  and not coalesce(s.es_prueba, false)), 0)
    + coalesce((select sum(ci.cantidad_contada - ci.cantidad_antes)
                from sgc.conteo_items ci
                join sgc.conteos_inventario c on c.id = ci.conteo_id
                where ci.articulo_id = p_articulo_id and c.bodega_id = p_bodega_id
                  and not coalesce(c.es_prueba, false)), 0);
$$;
grant execute on function sgc.stock_movimientos_sigma(uuid, uuid) to authenticated;
comment on function sgc.stock_movimientos_sigma(uuid, uuid) is
  'AP3/AP5 — suma neta de movimientos registrados (entradas − salidas + Δ conteos), sólo no-prueba, para reconciliar la base de apertura con el stock real.';

-- ── Apertura efectiva (explícita si existe; si no, base no rastreada) ─────────
create or replace function sgc.apertura_efectiva(p_articulo_id uuid, p_bodega_id uuid)
returns numeric
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(
    (select cantidad from sgc.stock_apertura
      where articulo_id = p_articulo_id and bodega_id = p_bodega_id),
    coalesce((select cantidad from sgc.stock_por_bodega
               where articulo_id = p_articulo_id and bodega_id = p_bodega_id), 0)
      - sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id)
  );
$$;
grant execute on function sgc.apertura_efectiva(uuid, uuid) to authenticated;
comment on function sgc.apertura_efectiva(uuid, uuid) is
  'AP5 — apertura efectiva: el valor explícito de stock_apertura si existe; si no, stock_actual − Σ movimientos (base no rastreada). Es la base del timeline del kardex.';

-- ── Edición del dato de apertura (SOLO admin, sin movimiento, con traza) ──────
create or replace function sgc.set_apertura(
  p_articulo_id uuid,
  p_bodega_id   uuid,
  p_cantidad    numeric
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_sigma   numeric;
  v_current numeric;
  v_old     numeric;
  v_target  numeric;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede editar el dato de apertura.'
      using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad de apertura debe ser mayor o igual a 0.';
  end if;

  v_sigma   := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  v_current := coalesce((select cantidad from sgc.stock_por_bodega
                          where articulo_id = p_articulo_id and bodega_id = p_bodega_id), 0);
  v_old     := sgc.apertura_efectiva(p_articulo_id, p_bodega_id);
  v_target  := p_cantidad + v_sigma;  -- stock que hace cerrar la curva en la nueva base

  if v_target < 0 then
    raise exception 'No puedes fijar la apertura en %: el almacén ya consumió más que eso (el disponible caería a %).',
      p_cantidad, v_target;
  end if;
  if v_target = v_current
     and exists (select 1 from sgc.stock_apertura
                 where articulo_id = p_articulo_id and bodega_id = p_bodega_id
                   and cantidad = p_cantidad) then
    return;  -- sin cambio
  end if;

  -- Re-basar la apertura explícita.
  insert into sgc.stock_apertura(articulo_id, bodega_id, cantidad, updated_at, updated_by)
    values (p_articulo_id, p_bodega_id, p_cantidad, now(), auth.uid())
  on conflict (articulo_id, bodega_id)
    do update set cantidad = excluded.cantidad, updated_at = now(), updated_by = auth.uid();

  -- Fijar el stock disponible a la base + Σ movimientos, SIN movimiento (no adjust_stock).
  insert into sgc.stock_por_bodega(articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, v_target, now())
  on conflict (articulo_id, bodega_id)
    do update set cantidad = v_target, updated_at = now();

  -- Traza interna (auditoría), NO visible en el kardex. accion ∈ {INSERT,UPDATE,DELETE}.
  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
    values ('stock_apertura',
            p_articulo_id::text || ':' || p_bodega_id::text,
            'UPDATE', auth.uid(),
            jsonb_build_object('op', 'set_apertura', 'delta_stock', v_target - v_current),
            jsonb_build_object('apertura', v_old),
            jsonb_build_object('apertura', p_cantidad));
end;
$$;
grant execute on function sgc.set_apertura(uuid, uuid, numeric) to authenticated;
comment on function sgc.set_apertura(uuid, uuid, numeric) is
  'AP5 — fija el saldo de apertura de un artículo×almacén (solo admin). Re-basa la apertura y el stock a apertura + Σ movimientos, SIN generar movimiento/notificación/kardex. Traza mínima en sgc.auditoria.';

commit;
