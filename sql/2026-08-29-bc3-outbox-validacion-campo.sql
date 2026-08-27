-- ============================================================================
-- PROMPT-21 (BC) FASE 3 — BC3: "Hay un dato con formato inválido en el registro"
--   El "Enlace de tarea" quedó 15 h atascado en el outbox de la app con un mensaje
--   genérico. RAÍZ (lado servidor):
--     · `enlazar_bitacora_tarea` recibía los ids como `uuid`. PostgREST castea
--       JSON→uuid EN EL BORDE: un id vacío ('') o mal formado revienta con
--       `22P02 invalid input syntax for type uuid` ANTES de entrar al cuerpo, y la
--       app lo humaniza a "dato con formato inválido" SIN decir qué campo.
--     · Además, si la bitácora referida nunca sincronizó (p. ej. por BC7), el id
--       apunta a una fila inexistente → el enlace nunca podía completarse.
--
-- FIX (contrato para el outbox — ver docs/BC3-outbox-validacion-contrato.md):
--   (1) Primitiva reutilizable `sgc.error_campo(campo, motivo, mensaje)` que lanza
--       un error TIPADO de validación: errcode 22023 (invalid_parameter_value),
--       `detail` = JSON {campo, motivo}, `hint` = campo. PostgREST lo devuelve como
--       {code, message, details, hint} → el cliente sabe QUÉ campo marcar y que es
--       de validación (NO reintentar solo; pedir corregir).
--   (2) `enlazar_bitacora_tarea` acepta los ids como TEXT y valida DENTRO:
--       requerido → formato uuid → existe. Cada fallo señala el campo. Así el error
--       llega descriptivo en vez de un 22P02 crudo del borde.
--
-- Aditivo. Reemplaza la firma uuid por text (ambos clientes envían strings JSON →
-- bind a text sin problema). Idempotente.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-29-bc3-outbox-validacion-campo.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Primitiva de error de validación con campo señalado ──────────────────
create or replace function sgc.error_campo(p_campo text, p_motivo text, p_mensaje text)
returns void
language plpgsql
immutable
as $function$
begin
  -- 22023 = invalid_parameter_value. `detail` lleva {campo, motivo} para que el
  -- cliente lo pinte y marque; `hint` repite el campo (acceso directo).
  raise exception '%', p_mensaje
    using errcode = '22023',
          detail  = json_build_object('campo', p_campo, 'motivo', p_motivo)::text,
          hint    = p_campo;
end;
$function$;
grant execute on function sgc.error_campo(text, text, text) to authenticated, service_role;

-- Helper: ¿es un uuid válido y no vacío? (sin lanzar).
create or replace function sgc.es_uuid(p text)
returns boolean language sql immutable as $function$
  select p is not null
     and p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;
grant execute on function sgc.es_uuid(text) to authenticated, service_role;

-- ── 2) enlazar_bitacora_tarea: ids TEXT + validación con campo señalado ─────
-- Se elimina la firma uuid (el borde reventaba antes de validar) y se crea la
-- firma text que valida dentro. Ambos clientes (web/app) envían strings.
drop function if exists sgc.enlazar_bitacora_tarea(uuid, uuid, boolean, text);

create or replace function sgc.enlazar_bitacora_tarea(
  p_tarea_id text,
  p_bitacora_id text,
  p_completar boolean default false,
  p_foto_path text default null
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_tarea    uuid;
  v_bitacora uuid;
  v_proyecto uuid;
begin
  -- tarea_id: requerido + formato + existe
  if coalesce(trim(p_tarea_id), '') = '' then
    perform sgc.error_campo('tarea_id', 'requerido', 'Falta la tarea a la que enlazar.');
  end if;
  if not sgc.es_uuid(trim(p_tarea_id)) then
    perform sgc.error_campo('tarea_id', 'formato_invalido', 'La tarea no tiene un identificador válido.');
  end if;
  v_tarea := trim(p_tarea_id)::uuid;

  -- bitacora_id: requerido + formato + existe
  if coalesce(trim(p_bitacora_id), '') = '' then
    perform sgc.error_campo('bitacora_id', 'requerido', 'Falta la bitácora a enlazar.');
  end if;
  if not sgc.es_uuid(trim(p_bitacora_id)) then
    perform sgc.error_campo('bitacora_id', 'formato_invalido', 'La bitácora no tiene un identificador válido.');
  end if;
  v_bitacora := trim(p_bitacora_id)::uuid;

  select proyecto_id into v_proyecto from sgc.cronograma_tareas where id = v_tarea;
  if not found then
    perform sgc.error_campo('tarea_id', 'no_existe', 'La tarea ya no existe o fue eliminada.');
  end if;

  if not exists (select 1 from sgc.bitacoras where id = v_bitacora) then
    -- típico cuando la bitácora aún no sincronizó (p. ej. quedó atascada por BC7):
    -- es un error de validación, NO transitorio del enlace en sí.
    perform sgc.error_campo('bitacora_id', 'no_existe',
      'La bitácora enlazada todavía no está guardada. Envía primero la bitácora y reintenta el enlace.');
  end if;

  if not sgc.puede_gestionar_cronograma(v_proyecto) then
    raise exception 'No tienes permiso para gestionar el cronograma de esta obra.'
      using errcode = '42501';
  end if;

  insert into sgc.cronograma_tarea_bitacoras (tarea_id, bitacora_id)
  values (v_tarea, v_bitacora)
  on conflict (tarea_id, bitacora_id) do nothing;

  if coalesce(p_completar, false) then
    if coalesce(trim(p_foto_path), '') = '' then
      perform sgc.error_campo('foto_path', 'requerida_para_completar',
        'Para completar la tarea hace falta una foto de evidencia.');
    end if;
    perform sgc.completar_tarea(v_tarea, p_foto_path, null, null);
  end if;
end;
$function$;

grant execute on function sgc.enlazar_bitacora_tarea(text, text, boolean, text) to authenticated, service_role;
