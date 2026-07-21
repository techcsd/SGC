-- ============================================================================
-- Actualización 3 · S10 — Nomenclatura estándar en liberación.
-- Renombra el NOMBRE VISIBLE de las plantillas CL-04..07 al lenguaje de la
-- bitácora (muros/columnas/vigas/losas). El `codigo` CL-XX queda intacto.
-- CL-01..03 (excavaciones/fundaciones) no cambian.
-- Validado con Xavier (21/07/2026): sin sufijo de sistema (Simmons/Golliat).
-- Las etiquetas de ítems (cl_plantilla_items) NO usan "elementos verticales/
-- horizontales" — usan Armado/Encofrado/Moldes/… — así que no requieren cambio.
-- Web y app leen estos nombres de BD (sin labels duplicados en frontend).
-- Aditivo / idempotente.
-- ============================================================================
set search_path = sgc, public;

update sgc.cl_plantillas set nombre = 'Armado de muros y columnas'    where codigo = 'CL-04';
update sgc.cl_plantillas set nombre = 'Encofrado de muros y columnas' where codigo = 'CL-05';
update sgc.cl_plantillas set nombre = 'Encofrado de vigas y losas'    where codigo = 'CL-06';
update sgc.cl_plantillas set nombre = 'Armado de vigas y losas'       where codigo = 'CL-07';
