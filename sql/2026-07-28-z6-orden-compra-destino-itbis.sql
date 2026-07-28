-- ============================================================================
-- Z6 — Orden de Compra: destino (proyecto|oficina) + ITBIS opcional
-- PROMPT-6 · FASE 3 · aditivo
-- ============================================================================

-- Destino: hoy solo proyecto. Se agrega 'oficina'. proyecto_id queda null cuando es oficina.
alter table sgc.ordenes_compra add column if not exists destino text not null default 'proyecto';
do $$ begin
  alter table sgc.ordenes_compra add constraint ordenes_compra_destino_chk check (destino in ('proyecto','oficina'));
exception when duplicate_object then null; end $$;

-- Backfill: sin proyecto_id => oficina.
update sgc.ordenes_compra set destino = 'oficina' where proyecto_id is null and destino = 'proyecto';

-- ITBIS opcional por orden (default ON). Apagado => total = subtotal, impuesto = 0.
alter table sgc.ordenes_compra add column if not exists aplica_impuesto boolean not null default true;
update sgc.ordenes_compra set aplica_impuesto = (coalesce(impuesto,0) > 0)
 where aplica_impuesto is true and coalesce(impuesto,0) = 0 and coalesce(subtotal,0) > 0;
