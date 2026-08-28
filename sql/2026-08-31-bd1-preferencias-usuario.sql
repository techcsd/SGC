-- BD1 — preferencias por usuario (server-side, sobreviven reinstalación y multi-
-- dispositivo). Bolsa jsonb genérica en sgc.usuarios + un RPC self-scoped para
-- fijar una clave. Primera clave: `agrupar_home` (bool) — el home agrupado deja de
-- ser default y pasa a ser una preferencia POR USUARIO, apagada por defecto.
-- Aditivo y retrocompatible: la web no lee esta columna todavía (no se rompe nada).
begin;

-- 1) Bolsa de preferencias por usuario. Nunca null (default '{}') para que el
--    cliente siempre lea un objeto. No la toca admin ni nadie salvo el dueño.
alter table sgc.usuarios add column if not exists preferencias jsonb not null default '{}'::jsonb;

-- 2) Fijar UNA preferencia del usuario logueado (self-scoped por auth.uid()).
--    Security definer para saltar la RLS admin-only de usuarios escribiendo SOLO
--    la fila del que llama. jsonb_set con create_missing=true (crea la clave si no
--    existe). NUNCA toca rol/permisos/es_prueba/login.
create or replace function sgc.mi_preferencia_set(p_clave text, p_valor jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_prefs jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;
  if p_clave is null or btrim(p_clave) = '' then
    raise exception 'Clave de preferencia vacía.';
  end if;

  update sgc.usuarios
  set preferencias = jsonb_set(coalesce(preferencias, '{}'::jsonb), array[p_clave], coalesce(p_valor, 'null'::jsonb), true),
      updated_at = now()
  where id = v_uid
  returning preferencias into v_prefs;

  return v_prefs;
end;
$$;

-- 3) Grants (schema ya expuesto; solo authenticated ejecuta su propio set).
grant execute on function sgc.mi_preferencia_set(text, jsonb) to authenticated;

commit;
