-- ============================================================================
-- W12 — última actividad del usuario en web y en app.
-- Columnas de perfil + RPC ligera con throttle server-side (máx. 1 update / 5 min
-- por canal). Baseline visible: auth.users.last_sign_in_at. Aditivo.
-- ============================================================================

set search_path = sgc, public;

alter table sgc.usuarios add column if not exists ultima_actividad_web timestamptz;
alter table sgc.usuarios add column if not exists ultima_actividad_app timestamptz;

-- Ping de actividad: actualiza el canal solo si el último ping es > 5 min
-- (evita escrituras en cada navegación). SECURITY DEFINER para escribir la
-- propia fila sin depender de la RLS de UPDATE de usuarios.
create or replace function sgc.ping_actividad(p_canal text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if p_canal = 'web' then
    update sgc.usuarios
       set ultima_actividad_web = now()
     where id = v_uid
       and (ultima_actividad_web is null or ultima_actividad_web < now() - interval '5 minutes');
  elsif p_canal = 'app' then
    update sgc.usuarios
       set ultima_actividad_app = now()
     where id = v_uid
       and (ultima_actividad_app is null or ultima_actividad_app < now() - interval '5 minutes');
  end if;
end;
$function$;

grant execute on function sgc.ping_actividad(text) to authenticated;
