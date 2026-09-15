-- BQ8 — Aviso cuando un molde queda fuera de tolerancia  ·  14/09/2026
-- ---------------------------------------------------------------------------------
-- Al guardar una medida de molde cuya desviación supera `molde_tolerancia_cm`
-- (parámetro, hoy = 2), avisa al módulo bitácora (in-app + push, respeta silencios
-- vía notif_permitida) con enlace a la vista de oficina /bitacora/moldes.
-- Trigger escritor inventariado (regla 13).  Idempotente.  Validar begin/rollback.
-- ---------------------------------------------------------------------------------

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('molde_desviacion', 'Molde fuera de tolerancia',
        'Una medida de molde superó la tolerancia contra el plano.',
        true, array['in_app','push']::text[], true, 55)
on conflict (tipo) do nothing;

create or replace function sgc.trg_molde_aviso_desviacion()
returns trigger
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_tol numeric := coalesce((select valor::numeric from sgc.parametros where clave='molde_tolerancia_cm'), 2);
begin
  if coalesce(new.desviacion_max_cm, 0) > v_tol and not coalesce(new.es_prueba, false) then
    perform sgc.notificar_modulo(
      'bitacora', 'molde_desviacion',
      'Molde fuera de tolerancia',
      format('%s %s: desvío de %s cm (tolerancia %s cm).',
        coalesce(new.estructura, 'Molde'), coalesce(new.identificador, ''),
        round(new.desviacion_max_cm, 1), v_tol),
      '/bitacora/moldes', new.id, 'molde');
  end if;
  return new;
end;
$function$;

drop trigger if exists molde_aviso_desviacion on sgc.bitacora_molde_medidas;
create trigger molde_aviso_desviacion
  after insert on sgc.bitacora_molde_medidas
  for each row execute function sgc.trg_molde_aviso_desviacion();
