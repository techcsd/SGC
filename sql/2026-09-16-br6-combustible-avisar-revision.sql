-- BR6 corolario (regla 15) — "Avisar a Logística" desde la app.
-- Cuando una echada de combustible se rechaza por NEGOCIO (galones sobre la
-- capacidad del tanque, precio fuera de banda…) y el chofer no puede corregirla,
-- la app le ofrece avisarle a Logística (Raykler) para que la registre él. Este
-- RPC es el destino de ese botón: reutiliza `notificar_modulo('flota', …)` (no
-- inventa canal) y el tipo `combustible_revisar` (ya sembrado por BR1).
--
-- Aditivo y retrocompatible. La app lo llama detrás de una comprobación de
-- capacidad (combustible-aviso.service.ts): si aún no está desplegado, la UI le
-- dice al chofer que se lo comente a Logística de palabra — no se rompe nada.
--
-- ⚠️ Este archivo vive en el repo de la APP (csd-app) por conveniencia de la
-- sesión; su HOGAR es el repo SGC. Cópialo a SGC/sql/ y aplícalo con
-- `node scripts/apply-migration.mjs` en la próxima sesión del padre (deploy
-- gateado a Xaviel).

create or replace function sgc.combustible_avisar_revision(
  p_resumen text,
  p_echada_id uuid default null
) returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if coalesce(btrim(p_resumen), '') = '' then
    raise exception 'Falta el resumen de la echada';
  end if;

  select nombre into v_nombre from sgc.usuarios where id = v_uid;

  perform sgc.notificar_modulo(
    'flota',
    'combustible_revisar',
    'Echada para revisar',
    coalesce(v_nombre, 'Un chofer') || ' pide registrar una echada: ' || p_resumen,
    '/flota/combustible-log'
      || case when p_echada_id is not null then '?echada=' || p_echada_id::text else '' end
  );
end;
$$;

grant execute on function sgc.combustible_avisar_revision(text, uuid) to authenticated;
