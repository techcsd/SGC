-- ============================================================================
-- AT17 (re-reporte de AK4) — el conduce "por confirmar" le llegaba a TODO el mundo
-- y el campanario mostraba "9+" a todos. Causa raíz: el parámetro
-- `confirmacion_roles_globales` daba capacidad de confirmar CUALQUIER conduce de
-- CUALQUIER obra (sin vínculo con la obra) a 7 roles de supervisión.
--
-- Fix (data, reversible): dejar como confirmadores GLOBALES solo a quienes de
-- verdad gestionan TODO el transporte de la empresa (admin + Logística y
-- Transportación / Raykler). El resto confirma SUS obras por las ramas ligadas a
-- la obra de `confirmadores_de_conduce`:
--   A) proyecto_responsables de la obra destino
--   C) can_confirm_reception vinculado a la obra
--   D) capataz / ingeniero_campo / gerente_produccion  *si están ligados a la obra*
-- Gerencia/Dirección/Jefe de ingenieros ven todo por sus vistas de supervisión,
-- pero NO reciben cada aviso (mismo criterio acordado para Sócrates en AT18).
-- ============================================================================
set search_path = sgc, public;

update sgc.parametros
   set valor = 'admin,logistica'
 where clave = 'confirmacion_roles_globales';

-- Si el parámetro no existiera (entorno recién levantado), sembrarlo.
insert into sgc.parametros (clave, valor)
select 'confirmacion_roles_globales', 'admin,logistica'
where not exists (select 1 from sgc.parametros where clave = 'confirmacion_roles_globales');
