-- ============================================================================
-- Z8 — Reposición accionable: posponer sugerencias (snooze) con motivo
-- PROMPT-6 · FASE 4
-- ============================================================================
-- Flujo decidido: desde cada sugerencia (artículo bajo mínimo) el usuario puede
--   (1) generar una solicitud de compra (front → crear_solicitud_compra),
--   (2) editar el mínimo (front → update articulos.stock_minimo),
--   (3) POSPONER la sugerencia con motivo por N días (esta tabla).
-- El listado de reposición oculta las sugerencias pospuestas cuya fecha aún no
-- llega. Aditivo.
-- ============================================================================

create table if not exists sgc.reposicion_snooze (
  id           uuid primary key default gen_random_uuid(),
  articulo_id  uuid not null references sgc.articulos(id) on delete cascade,
  bodega_id    uuid references sgc.bodegas(id) on delete cascade,  -- null = vista global
  snooze_until date not null,
  motivo       text,
  creado_por   uuid references sgc.usuarios(id) on delete set null,
  created_at   timestamptz not null default now()
);
-- Una sugerencia activa por (articulo, bodega). bodega null se trata como global.
create unique index if not exists uq_reposicion_snooze
  on sgc.reposicion_snooze (articulo_id, coalesce(bodega_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table sgc.reposicion_snooze enable row level security;
drop policy if exists "reposicion_snooze: inventario" on sgc.reposicion_snooze;
create policy "reposicion_snooze: inventario" on sgc.reposicion_snooze
  for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('inventario'));

grant select, insert, update, delete on sgc.reposicion_snooze to authenticated;
grant all on sgc.reposicion_snooze to service_role;

-- Posponer (upsert): renueva la fecha/motivo si ya existía.
create or replace function sgc.posponer_reposicion(
  p_articulo_id uuid, p_bodega_id uuid, p_dias int, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Sin permiso';
  end if;
  insert into sgc.reposicion_snooze (articulo_id, bodega_id, snooze_until, motivo, creado_por)
  values (p_articulo_id, p_bodega_id, current_date + greatest(coalesce(p_dias,7),1), p_motivo, auth.uid())
  on conflict (articulo_id, coalesce(bodega_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set snooze_until = excluded.snooze_until, motivo = excluded.motivo, creado_por = excluded.creado_por, created_at = now();
end;
$function$;
grant execute on function sgc.posponer_reposicion(uuid,uuid,int,text) to authenticated, service_role;
