-- AZ1 — El contrato del paso Firma se muestra con datos reales (merge) y se congela al firmar.
-- (a) La empresa necesita 'representante' (representante legal) como fuente de {{representante_empresa}}.
-- (c) La firma guarda un SNAPSHOT: valores resueltos + HTML final congelado, para que editar la ficha
--     después no reescriba un contrato ya firmado. Todo aditivo y retrocompatible.

-- Representante legal de la empresa (fuente de {{representante_empresa}} en las plantillas).
alter table sgc.empresa add column if not exists representante text;

-- Snapshot del documento firmado (valores resueltos + HTML congelado al momento de la firma).
alter table sgc.personal_obra_firmas add column if not exists valores jsonb;
alter table sgc.personal_obra_firmas add column if not exists documento_html text;

comment on column sgc.personal_obra_firmas.valores is
  'AZ1 — valores resueltos de las variables de la plantilla, congelados al firmar.';
comment on column sgc.personal_obra_firmas.documento_html is
  'AZ1 — HTML final del documento (placeholders ya resueltos), congelado al firmar. El PDF/impresión sale de aquí.';
