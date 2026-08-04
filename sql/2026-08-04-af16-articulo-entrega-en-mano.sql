-- AF16 — Artículos de alto valor / entrega en mano. Los conduces que llevan un
-- item marcado así NO pueden cerrarse con auto-recepción del chofer: exigen la
-- confirmación presencial del responsable. Aquí se agrega el FLAG del catálogo;
-- la app lo destaca visualmente y bloquea la auto-recepción cuando está presente.
-- Aditivo y retrocompatible. La lista inicial de artículos la marca Xaviel en el
-- catálogo (web); por defecto ningún artículo queda marcado.

alter table sgc.articulos
  add column if not exists entrega_en_mano boolean not null default false;
comment on column sgc.articulos.entrega_en_mano is
  'AF16 — alto valor / entrega en mano: la entrega exige confirmación presencial del responsable (no auto-recepción del chofer).';
