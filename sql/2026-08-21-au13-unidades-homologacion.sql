-- AU13 — Homologación de unidades escritas a mano en artículos legacy (imports).
-- ⚠️ PRESENTAR A XAVIEL ANTES DE APLICAR (criterio AM8). Mapea las variantes de texto
-- libre a los códigos del catálogo `sgc.unidades`. Requiere que el catálogo ya tenga
-- 'paquete' (ver au13-unidades-catalogo). Idempotente.
--
-- Mapeo (conteos al 21/08/2026):
--   UND (158), PZA (13), '20' (1)  → unidad     (pieza/unidad; '20' es dato basura → mejor guess)
--   CAJA (4)                        → caja
--   PAQUETE (2)                     → paquete
--   PAR (1)                         → par
--   PIES (1)                        → pie
-- Ya correctos (codigo de catálogo, no se tocan): unidad, par, lb, paquete, resma, juego.

update sgc.articulos set unidad = 'unidad'  where unidad in ('UND', 'PZA', '20');
update sgc.articulos set unidad = 'caja'    where unidad = 'CAJA';
update sgc.articulos set unidad = 'paquete' where unidad = 'PAQUETE';
update sgc.articulos set unidad = 'par'     where unidad = 'PAR';
update sgc.articulos set unidad = 'pie'     where unidad = 'PIES';
