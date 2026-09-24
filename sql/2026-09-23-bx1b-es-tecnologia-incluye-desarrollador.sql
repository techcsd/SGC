-- ============================================================================
-- BX1b (para el PADRE/SGC) — es_tecnologia() debe reconocer al rol Developer
--
-- HALLAZGO (hijo, PROMPT-65 F2, verificado en dev fzfrnrvndzrjwyvdpkgg):
--   sgc.es_desarrollador()  -> TRUE  para el rol `desarrollador`  ✔ (fuente única OK)
--   sgc.es_tecnologia()     -> FALSE para el rol `desarrollador`  ✖
--
-- CAUSA: es_tecnologia() (z26-tecnologia-gate-roles.sql) es POR ROL
--   (admin|tecnologia|gerencia|direccion), NO por módulo. El comentario del
--   bx1-rol-desarrollador.sql ("Como TIENE el módulo, es_tecnologia() es verdadero")
--   es incorrecto: tener el módulo `tecnologia` NO hace verdadero es_tecnologia().
--
-- CONSECUENCIA (web y app): el rol Developer NO puede leer `app_error_reports`
--   (RLS es_tecnologia()) ni marcar versión/mínima (marcar_version usa es_tecnologia()),
--   pese a que BX1 lo pide ("errores de la app, versiones"). En la APP el hijo, por
--   regla 4/AU8, NO le pinta la pestaña "Reportes de errores" (sería un panel vacío).
--
-- ARREGLO PROPUESTO (elige uno; el hijo activará la pestaña de errores para el
--   Developer en cuanto esto viva en dev):
--   (A) Añadir 'desarrollador' a es_tecnologia()  ← recomendado, mínimo y directo.
--   (B) O que las RLS/RPC de errores/versiones acepten es_tecnologia() OR es_desarrollador().
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-23-bx1b-es-tecnologia-desarrollador.sql --env dev  →  --env prod
-- ============================================================================
begin;

create or replace function sgc.es_tecnologia()
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select exists (
    select 1
    from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin', 'tecnologia', 'gerencia', 'direccion', 'desarrollador')
  );
$$;

commit;
