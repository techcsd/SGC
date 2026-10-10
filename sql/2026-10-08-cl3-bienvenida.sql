-- 2026-10-08-cl3-bienvenida.sql — CL3 (reglas 18/19)
--
-- Flag por usuario de "ya vio la bienvenida" (web y app, versionados). Un usuario NUEVO
-- (sin flag) ve la bienvenida en su primer ingreso; los existentes quedan marcados como
-- vistos (backfill en scripts/data-fixes/2026-10-08-cl3-bienvenida-backfill.mjs, --dry-run).
--
--   node scripts/apply-migration.mjs sql/2026-10-08-cl3-bienvenida.sql --env dev
--   node scripts/apply-migration.mjs sql/2026-10-08-cl3-bienvenida.sql --env prod  (tras OK)

begin;

alter table sgc.usuario_preferencias
  add column if not exists bienvenida_web_v1_vista timestamptz,
  add column if not exists bienvenida_app_v2_vista timestamptz;

-- Marca la bienvenida como vista para el usuario actual (canal 'web' | 'app').
create or replace function sgc.marcar_bienvenida_vista(p_canal text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if p_canal not in ('web','app') then
    raise exception 'Canal inválido: %', p_canal using errcode = '22023';
  end if;
  insert into sgc.usuario_preferencias (usuario_id)
    values (auth.uid())
  on conflict (usuario_id) do nothing;
  if p_canal = 'web' then
    update sgc.usuario_preferencias set bienvenida_web_v1_vista = coalesce(bienvenida_web_v1_vista, now())
      where usuario_id = auth.uid();
  else
    update sgc.usuario_preferencias set bienvenida_app_v2_vista = coalesce(bienvenida_app_v2_vista, now())
      where usuario_id = auth.uid();
  end if;
end $function$;

-- Lee el estado de bienvenida del usuario actual (para decidir si mostrarla).
create or replace function sgc.bienvenida_estado()
 returns table(web timestamptz, app timestamptz)
 language sql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select bienvenida_web_v1_vista, bienvenida_app_v2_vista
  from sgc.usuario_preferencias where usuario_id = auth.uid();
$function$;

grant execute on function sgc.marcar_bienvenida_vista(text) to authenticated, service_role;
grant execute on function sgc.bienvenida_estado() to authenticated, service_role;

commit;
