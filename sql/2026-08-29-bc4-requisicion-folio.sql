-- ============================================================================
-- PROMPT-21 (BC) FASE 4 — BC4: la requisición necesita un CÓDIGO citable (REQ-XXX).
--   Hoy la requisición sólo tiene UUID → no se puede rotular "CONDUCE (#REQ)" (BA6)
--   ni citarla en la app/web. Se agrega un folio secuencial legible.
--
-- Diseño:
--   · `solicitudes_material.folio` bigint UNIQUE, asignado por un TRIGGER
--     BEFORE INSERT **SECURITY DEFINER** (crear_solicitud_material es SECURITY
--     INVOKER → un default nextval() exigiría GRANT USAGE de la secuencia al rol
--     `authenticated`, el landmine recurrente `permission denied for sequence`).
--     El trigger definer corre como owner → sin grants sueltos de secuencia.
--   · Código presentable = `REQ-` + folio a 6 dígitos (se arma en el cliente y en
--     la RPC de detalle). El folio crudo viaja en el row (`select *`).
--   · Backfill de las requisiciones existentes por orden de creación.
--
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-29-bc4-requisicion-folio.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Secuencia + columna ──────────────────────────────────────────────────
create sequence if not exists sgc.solicitudes_material_folio_seq;

alter table sgc.solicitudes_material
  add column if not exists folio bigint;

-- ── 2) Backfill determinista (por created_at) de las que aún no tienen folio ─
with faltan as (
  select id, row_number() over (order by created_at, id) as rn
  from sgc.solicitudes_material
  where folio is null
)
update sgc.solicitudes_material s
   set folio = nextval('sgc.solicitudes_material_folio_seq')
  from faltan f
 where s.id = f.id;

-- Alinea la secuencia por encima del máximo backfilleado.
select setval('sgc.solicitudes_material_folio_seq',
              coalesce((select max(folio) from sgc.solicitudes_material), 0) + 1,
              false);

-- ── 3) Unicidad + asignación automática por trigger SECURITY DEFINER ────────
create unique index if not exists solicitudes_material_folio_uidx
  on sgc.solicitudes_material(folio);

create or replace function sgc.trg_solicitud_material_folio()
returns trigger
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
begin
  if new.folio is null then
    new.folio := nextval('sgc.solicitudes_material_folio_seq');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_solicitud_material_folio on sgc.solicitudes_material;
create trigger trg_solicitud_material_folio
  before insert on sgc.solicitudes_material
  for each row execute function sgc.trg_solicitud_material_folio();
