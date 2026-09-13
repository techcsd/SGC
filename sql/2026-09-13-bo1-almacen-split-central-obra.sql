-- ============================================================================
-- PROMPT-44 (BO) FASE 2 — BO1: partir el sobrecargado `es_principal` de bodegas en
-- DOS columnas con significado único.  Ronda 13/09/2026.  Aditivo, idempotente.
--
-- PROBLEMA.  `sgc.bodegas.es_principal` significaba TRES cosas a la vez:
--   1) "central global" (el DDL, el badge "Principal (global)", almacenes_destino
--      que filtra proyecto_id is null),
--   2) "desempate por obra" (6 consumidores: resolver_bodega_origen + 4 RPCs de
--      devolución + ae-existencias-de-obra + ah9-destinos, todos
--      `order by coalesce(es_principal,false) desc, created_at asc limit 1`),
--   3) "es central" (apertura.ts → es_central: !!b.es_principal).
--   Además NADA impedía tener varios `true` por obra (0 índices/constraints).
--
-- SPLIT (§E-1, elegido por Xaviel).  Dos columnas fuente-de-verdad:
--   · es_central        boolean  — la central global (proyecto_id null).
--   · es_principal_obra boolean  — el principal DE una obra (único por proyecto).
--
-- REGLA 12 (estrena esta tanda) — "cuando un modelo reemplaza a otro, el viejo se
-- retira o se documenta quién lo sigue leyendo".  `es_principal` se conserva como
-- PUENTE LEGACY de SÓLO LECTURA, mantenido en sincronía por trigger
--   es_principal := es_central OR es_principal_obra
-- para que los lectores existentes sigan correctos SIN reescribir 8 RPCs de prod en
-- una sola migración (riesgo alto).  Es funcionalmente idéntico a migrarlos: en una
-- consulta por obra (proyecto_id = X) los es_central quedan fuera (tienen proyecto_id
-- null), así que dentro de la obra es_principal == es_principal_obra; y en
-- almacenes_destino (proyecto_id null) es_principal == es_central.
--
--   LECTORES DEL PUENTE `es_principal` (inventario regla 12):
--     · sgc.resolver_bodega_origen            (am1)   order by es_principal desc
--     · sgc.registrar_devolucion_obra          (p12)   order by es_principal desc
--     · sgc.registrar_devolucion_obra (idemp)  (ae7)   order by es_principal desc
--     · devolución confirma almacén            (ae8)   order by es_principal desc
--     · devolución chofer firmas               (ae)    order by es_principal desc
--     · existencias de obra                     (ae)    order by es_principal desc
--     · sgc.almacenes_destino                  (al8)   order by es_principal desc
--     · sgc.destinos_transporte                (ah9)   order by es_principal desc
--   ESCRITORES (ya migrados a las columnas nuevas en el front, BO1):
--     · Inventario→Almacenes (bodegas.ts) · alta de almacén de obra (lista.ts)
--   FECHA DE RETIRO DEL PUENTE: cuando los 8 lectores pasen a es_central /
--     es_principal_obra (ronda BP o posterior).  Hasta entonces el trigger lo
--     mantiene sincronizado y NADIE debe escribir es_principal directo.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-13-bo1-almacen-split-central-obra.sql
-- ============================================================================

begin;

-- 1) Columnas fuente-de-verdad (regla 2: NOT NULL con default).
alter table sgc.bodegas
  add column if not exists es_central        boolean not null default false,
  add column if not exists es_principal_obra boolean not null default false;

comment on column sgc.bodegas.es_central is
  'BO1 — la central global (proyecto_id null), origen de material hacia obras. Fuente de verdad; reemplaza el uso "global" de es_principal.';
comment on column sgc.bodegas.es_principal_obra is
  'BO1 — el almacén principal DE una obra (único por proyecto). Desempata el origen/destino cuando una obra tiene varios almacenes.';
comment on column sgc.bodegas.es_principal is
  'LEGACY (BO1, regla 12) — puente de SÓLO LECTURA = es_central OR es_principal_obra, sincronizado por trigger. NO escribir directo. Lectores y fecha de retiro documentados en la migración 2026-09-13-bo1.';

-- 2) Backfill desde el modelo viejo.
update sgc.bodegas
   set es_central        = (coalesce(es_principal,false) and proyecto_id is null),
       es_principal_obra = (coalesce(es_principal,false) and proyecto_id is not null);

-- 3) Un solo principal POR OBRA (candado que faltaba). Índice único parcial
--    (mismo patrón que proyecto_responsables, av3).
create unique index if not exists uq_bodega_principal_obra
  on sgc.bodegas (proyecto_id)
  where es_principal_obra and activo and proyecto_id is not null;

-- 4a) Sincroniza el puente legacy es_principal ANTES de escribir.
create or replace function sgc.bodega_sync_es_principal()
returns trigger language plpgsql as $$
begin
  NEW.es_principal := coalesce(NEW.es_central, false) or coalesce(NEW.es_principal_obra, false);
  -- es_central sólo tiene sentido en una central (sin obra); es_principal_obra sólo
  -- en un almacén de obra. Se normaliza para que el modelo no quede contradictorio.
  if NEW.proyecto_id is not null then NEW.es_central := false; end if;
  if NEW.proyecto_id is null     then NEW.es_principal_obra := false; end if;
  return NEW;
end;
$$;
drop trigger if exists trg_bodega_sync_es_principal on sgc.bodegas;
create trigger trg_bodega_sync_es_principal
  before insert or update of es_central, es_principal_obra, proyecto_id on sgc.bodegas
  for each row execute function sgc.bodega_sync_es_principal();

-- 4b) Al marcar un almacén como principal de su obra, desmarca los demás de esa obra.
create or replace function sgc.bodega_principal_obra_unico()
returns trigger language plpgsql as $$
begin
  if coalesce(NEW.es_principal_obra, false) and coalesce(NEW.activo, true)
     and NEW.proyecto_id is not null then
    update sgc.bodegas
       set es_principal_obra = false
     where proyecto_id = NEW.proyecto_id and id <> NEW.id and es_principal_obra;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_bodega_principal_obra_unico on sgc.bodegas;
create trigger trg_bodega_principal_obra_unico
  after insert or update of es_principal_obra, activo, proyecto_id on sgc.bodegas
  for each row execute function sgc.bodega_principal_obra_unico();

-- 5) Re-sincroniza es_principal en las filas existentes (por si el backfill dejó
--    algo fuera de fase) — dispara el trigger BEFORE.
update sgc.bodegas set es_central = es_central;

commit;
