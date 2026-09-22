-- BV1b (hijo → padre) — "Mi permiso de echada retroactiva": el chofer necesita saber,
-- desde la app, si tiene un permiso VIGENTE para registrar una echada de fecha pasada
-- (y su rango: hasta cuántos días atrás), para MOSTRAR el campo Fecha solo cuando aplica.
-- `permisos_combustible_retro_listar` es admin/flota-only; esto es la versión "mía".
-- Additive, self-contained, backward-compatible. Léelo detrás de comprobación de
-- capacidad en la app (si no está desplegado, el campo Fecha simplemente no aparece).
-- Lo aplica el PADRE (SGC) con su ledger: --env dev  →  --env prod (regla 18 + regla 11/AU1).
begin;

create or replace function sgc.mis_permisos_retro()
 returns table(id uuid, dias_max integer, vence date, desde date, motivo text)
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select pr.id, pr.dias_max, pr.vence,
         (current_date - pr.dias_max) as desde, pr.motivo
  from sgc.combustible_permisos_retro pr
  where pr.usuario_id = auth.uid()
    and pr.activo
    and pr.vence >= current_date
  order by pr.created_at desc;
$function$;

grant execute on function sgc.mis_permisos_retro() to authenticated, service_role;

commit;
