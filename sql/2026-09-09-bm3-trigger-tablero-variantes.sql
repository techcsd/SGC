-- ============================================================================
-- PROMPT-40 (BM) FASE 2 — BM3: destrabar las dos variantes de echada que hoy NO
-- pueden insertar NUNCA.  Ronda 09/09/2026.  Aditivo, idempotente.
--
-- RAÍZ (familia BG5 — un constraint escrito para un caso que después se amplió y
-- nadie volvió a mirar): AS15 instaló un trigger BEFORE INSERT *incondicional*
-- (2026-08-19-as5-as7-as15-…:101-124) que exige foto_tablero_path en TODA fila de
-- registros_combustible.  Pero DOS flujos entregados no tienen tablero POR DISEÑO:
--   · echada de PERSONA (Z23-app): 2 fotos, sin odómetro/tablero
--     (combustible.service.ts:336 "sin tablero en echada de persona"); el RPC anula
--     el kilometraje y acepta p_foto_tablero_path null.
--   · DEPÓSITO EN OBRA (AC11): 1 sola evidencia.jpg en el slot 'recibo'
--     (combustible.service.ts:332-334); origen='deposito_obra'.
-- El RPC las contempla; el trigger las MATA con un P0001 → la app pide una foto que
-- ese flujo no captura.  Resultado: imposibles de insertar en producción.
--
-- FIX: gatear el trigger.  El tablero sigue OBLIGATORIO para la echada normal de
-- estación con vehículo (que sí tiene odómetro/tablero); se EXIME a las dos
-- variantes por su predicado exacto (mismo que usa el RPC):
--     origen = 'deposito_obra'  OR  titular_es_persona = true
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm3-trigger-tablero-variantes.sql
-- ============================================================================

begin;

create or replace function sgc.trg_combustible_requiere_tablero()
returns trigger
language plpgsql
as $function$
begin
  -- BM3 — el tablero es obligatorio SÓLO para la echada de estación con vehículo.
  -- La echada de persona (sin odómetro) y el depósito en obra (una sola evidencia)
  -- no tienen tablero por diseño; el RPC ya las permite → el trigger no las mata.
  if coalesce(new.origen, 'estacion') <> 'deposito_obra'
     and not coalesce(new.titular_es_persona, false)
     and (new.foto_tablero_path is null or btrim(new.foto_tablero_path) = '') then
    raise exception 'La foto del tablero (odómetro/nivel) es obligatoria para registrar combustible.';
  end if;
  return new;
end;
$function$;

-- El trigger ya existe (AS15); recrearlo es no-op salvo el cuerpo actualizado.
drop trigger if exists combustible_requiere_tablero on sgc.registros_combustible;
create trigger combustible_requiere_tablero
  before insert on sgc.registros_combustible
  for each row execute function sgc.trg_combustible_requiere_tablero();

commit;
