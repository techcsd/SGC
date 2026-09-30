-- ============================================================================
-- CC4 (PROMPT-74 F7) — Importar datos de Odoo en su módulo (Compras/Flota/Inv).
-- Nota #87: Raykler sube proveedores desde Odoo; el archivo llega tal cual de Odoo.
-- ----------------------------------------------------------------------------
-- Esta migración solo aporta la CLAVE DE IDEMPOTENCIA: el `ID` externo de Odoo
-- (`__export__.res_partner_123_abc`) → `odoo_ref`. Reimportar ACTUALIZA en vez de
-- duplicar. El resto de CC4 (perfiles Odoo, mapeos, UI) es frontend.
--
-- ADITIVO: columna `odoo_ref` + índice único parcial en proveedores/vehiculos/articulos.
-- BU1 (regla 18): --env dev primero, luego --env prod --yes.
-- ============================================================================

begin;

alter table sgc.proveedores add column if not exists odoo_ref text;
alter table sgc.vehiculos   add column if not exists odoo_ref text;
alter table sgc.articulos   add column if not exists odoo_ref text;

create unique index if not exists uq_proveedores_odoo_ref
  on sgc.proveedores (odoo_ref) where odoo_ref is not null;
create unique index if not exists uq_vehiculos_odoo_ref
  on sgc.vehiculos (odoo_ref) where odoo_ref is not null;
create unique index if not exists uq_articulos_odoo_ref
  on sgc.articulos (odoo_ref) where odoo_ref is not null;

comment on column sgc.proveedores.odoo_ref is 'CC4 — ID externo de Odoo (idempotencia de importación).';
comment on column sgc.vehiculos.odoo_ref   is 'CC4 — ID externo de Odoo (idempotencia de importación).';
comment on column sgc.articulos.odoo_ref   is 'CC4 — ID externo de Odoo (idempotencia de importación).';

commit;
