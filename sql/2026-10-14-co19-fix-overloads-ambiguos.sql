-- ============================================================================
-- CO19 — HOTFIX (14/10/2026): overloads ambiguos dejados por CO15 y CO4.
--
-- `create or replace function` con un argumento nuevo al final NO reemplaza la
-- versión vieja cuando cambia el conteo de parámetros — crea un OVERLOAD nuevo.
-- Cualquier llamada que mande exactamente los args viejos (sin el nuevo, que
-- tiene DEFAULT) queda ambigua entre "exacto sin el default" y "con el
-- default" → Postgres responde 42725 function is not unique. Gotcha ya
-- documentado (version_publicada); se repitió en:
--   - registrar_combustible_app: CO15 le agregó p_numero_recibo (21→22 args)
--     sin dropear la de 21. Cualquier cliente (web/app) que NO mande
--     p_numero_recibo rompe con 42725 — esto incluye el main de PROD ahora
--     mismo, que todavía no tiene el código nuevo.
--   - requisiciones_bandeja: CO4 le agregó p_desde/p_hasta/p_solicitante_id
--     (5→8 args) sin dropear la de 5. Mismo problema para cualquier
--     listado de requisiciones que no mande los 3 nuevos.
--
-- Se dropea SOLO la firma vieja (menos args); la nueva (superset, con los
-- defaults) queda como la única — es retrocompatible para cualquier llamador
-- viejo que no conozca los parámetros nuevos.
-- ============================================================================
begin;
set local search_path = sgc, public;

drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text,
  text, text, text, text, boolean, text, text, uuid, boolean, text
);

drop function if exists sgc.requisiciones_bandeja(text, uuid, text, text, integer);

commit;
