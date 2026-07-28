-- Y11 — Alinear es_tecnologia() al MÓDULO 'tecnologia' (no al codigo de rol).
-- Antes chequeaba r.codigo in ('admin','tecnologia'); si "Encargado de Tecnología"
-- (u otro rol futuro) tiene el módulo pero un codigo distinto, veía la sección
-- pero no podía leer app_error_reports. Ahora es consistente con el gating por
-- módulo que usan la web y la app. Estrictamente MÁS inclusivo (admin siempre;
-- cualquier rol que otorgue el módulo 'tecnologia'). Aditivo/retrocompatible.

create or replace function sgc.es_tecnologia()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'public'
as $function$
  select sgc.is_admin() or sgc.tiene_modulo('tecnologia');
$function$;
