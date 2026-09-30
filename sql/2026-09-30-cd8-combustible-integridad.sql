-- ============================================================================
-- CD8 (nota #99) — revisión a fondo de combustible + duplicados.
--
-- Diagnóstico (prod, read-only, 30-sep): 273 echadas (198 importadas, 106 ya
-- invalidadas, 73 con client_uuid). numero_recibo (CC6) está 0% poblado → la unicidad
-- /fusión por recibo NO puede operar todavía. 25 PARES candidatos a duplicado (mismo
-- vehículo, fecha ±2 h, galones ±0.5%), la mayoría importada↔importada (el informe de
-- Total Energies trae la misma echada repetida) + algunos manual↔manual (doble envío
-- sin idempotencia, client_uuid distinto). Detalle en docs/REVISION-COMBUSTIBLE-2026-09.md.
--
-- Esta migración añade la HERRAMIENTA NO DESTRUCTIVA (Raykler/admin revisa par a par) +
-- infraestructura de integridad. La corrección de los duplicados reales EXISTENTES va
-- SOLO con la lista revisada por Xaviel/Raykler usando la herramienta — nunca un script
-- masivo. Nada se BORRA: "son la misma" = invalida una (invalidada=true + motivo).
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd8-combustible-integridad.sql --env dev  →  --env prod
-- ============================================================================
begin;

-- ── 1. Memoria de pares marcados "son distintas" (para no re-sugerir) ───────
create table if not exists sgc.echada_duplicado_descartado (
  id            uuid primary key default gen_random_uuid(),
  echada_a      uuid not null references sgc.registros_combustible(id) on delete cascade,
  echada_b      uuid not null references sgc.registros_combustible(id) on delete cascade,
  decidido_por  uuid references sgc.usuarios(id),
  decidido_en   timestamptz not null default now(),
  constraint echada_dup_desc_orden check (echada_a < echada_b),
  unique (echada_a, echada_b)
);
alter table sgc.echada_duplicado_descartado enable row level security;
drop policy if exists "echada_dup_desc: flota" on sgc.echada_duplicado_descartado;
create policy "echada_dup_desc: flota" on sgc.echada_duplicado_descartado
  for select to authenticated using (sgc.es_flota_elevado() or sgc.is_admin());

-- ── 2. Detección: posibles duplicados (pares candidatos, no resueltos) ──────
-- Mismo vehículo + fecha ±2 h + galones ±0.5%, o mismo numero_recibo cuando exista.
-- Excluye invalidadas, reenvíos legítimos (reenvio_de) y los ya descartados.
create or replace function sgc.echadas_posibles_duplicados()
returns table(
  a_id uuid, b_id uuid, vehiculo_id uuid, placa text, fecha date,
  galones_a numeric, galones_b numeric, recibo_a text, recibo_b text,
  importada_a boolean, importada_b boolean, tipo text)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  with base as (
    select rc.id, rc.vehiculo_id, rc.fecha, coalesce(rc.created_at, rc.fecha::timestamptz) ts,
           rc.galones, rc.numero_recibo, rc.importada, rc.reenvio_de
    from sgc.registros_combustible rc
    where coalesce(rc.invalidada,false)=false and rc.vehiculo_id is not null
  )
  select a.id, b.id, a.vehiculo_id, v.placa::text, a.fecha,
         a.galones, b.galones, a.numero_recibo::text, b.numero_recibo::text,
         a.importada, b.importada,
         case
           when a.numero_recibo is not null and a.numero_recibo = b.numero_recibo then 'mismo_recibo'
           when a.importada and b.importada then 'importada_x2'
           when not coalesce(a.importada,false) and not coalesce(b.importada,false) then 'manual_x2'
           else 'importada_manual'
         end as tipo
  from base a
  join base b on a.vehiculo_id = b.vehiculo_id and a.id < b.id
  left join sgc.vehiculos v on v.id = a.vehiculo_id
  where a.reenvio_de is distinct from b.id and b.reenvio_de is distinct from a.id
    and (
      (a.numero_recibo is not null and a.numero_recibo = b.numero_recibo)
      or (abs(extract(epoch from (a.ts-b.ts))) <= 7200
          and abs(coalesce(a.galones,0)-coalesce(b.galones,0))
              <= greatest(coalesce(a.galones,0),coalesce(b.galones,0))*0.005 + 0.01)
    )
    and not exists (select 1 from sgc.echada_duplicado_descartado d
                     where d.echada_a = least(a.id,b.id) and d.echada_b = greatest(a.id,b.id))
  order by a.fecha desc;
$function$;
grant execute on function sgc.echadas_posibles_duplicados() to authenticated;

-- ── 3. Resolución par a par (nunca borra) ───────────────────────────────────
-- decision='misma' → invalida p_invalidar (marca motivo) y recalcula. 'distintas' →
-- recuerda el par para no re-sugerir. Gate flota-elevado/admin.
create or replace function sgc.resolver_duplicado_echada(
  p_a uuid, p_b uuid, p_decision text, p_invalidar uuid default null)
returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare v_lo uuid := least(p_a,p_b); v_hi uuid := greatest(p_a,p_b);
begin
  if not (sgc.es_flota_elevado() or sgc.is_admin()) then raise exception 'No autorizado.'; end if;
  if p_decision = 'distintas' then
    insert into sgc.echada_duplicado_descartado(echada_a, echada_b, decidido_por)
      values (v_lo, v_hi, auth.uid())
      on conflict (echada_a, echada_b) do nothing;
  elsif p_decision = 'misma' then
    if p_invalidar is null or p_invalidar not in (p_a,p_b) then
      raise exception 'p_invalidar debe ser una de las dos echadas del par.';
    end if;
    update sgc.registros_combustible
       set invalidada = true,
           saneamiento_motivo = concat_ws(' · ', saneamiento_motivo,
             'CD8 — duplicado de ' || (case when p_invalidar=p_a then p_b else p_a end)::text || ' (marcado por revisión)')
     where id = p_invalidar and coalesce(invalidada,false)=false;
    -- recálculo de KPIs (best-effort; la función ya excluye invalidadas). Sin args.
    perform sgc.recalcular_estados_combustible();
  else
    raise exception 'decision invalida: use misma | distintas';
  end if;
end;
$function$;
grant execute on function sgc.resolver_duplicado_echada(uuid,uuid,text,uuid) to authenticated;

-- ── 4. Unicidad parcial por recibo (future-proof; hoy 0 recibos → no rompe) ──
-- Cuando numero_recibo se pople (CC6), impide dos echadas VIGENTES del mismo vehículo
-- con el mismo recibo. Parcial sobre no-invalidadas para no chocar con el histórico.
create unique index if not exists uq_combustible_vehiculo_recibo
  on sgc.registros_combustible (vehiculo_id, numero_recibo)
  where numero_recibo is not null and coalesce(invalidada,false) = false;

commit;
